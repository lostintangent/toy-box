import { SessionConnectionUnavailableError } from "@providers/server/provider";
import type { ModelConfiguration } from "@providers/model";
import type { SessionEvent, SessionMessage, SessionSkill } from "@sessions/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import type { SessionConfiguration, SessionConnection } from "@providers/server/provider";
import type {
  DynamicToolCallParams,
  DynamicToolCallResponse,
  ThreadListResponse,
  ToolRequestUserInputResponse,
  Turn,
  ReasoningEffort,
} from "./protocol";
import { CodexTransport, type RpcNotification, type RpcRequest } from "./protocol/transport";
import { createCodexProjector, itemTimestamp, subagentThreadId } from "./projector";
import { encodeInput } from "./messages";
import { readThreadHistory } from "./history";

/** One question in a native batch; Codex receives every answer in one response. */
type PendingQuestion = {
  id: string;
  toolCallId: string;
  batch: {
    rpcId: string | number;
    size: number;
    answers: ToolRequestUserInputResponse["answers"];
  };
};

export class CodexConnection implements SessionConnection {
  #listeners = new Set<(event: SessionEvent) => void>();
  #dispose: (() => void)[];
  #project: ReturnType<typeof createCodexProjector>;
  #model: ModelConfiguration;
  /** Running turns by thread: the root's and its direct subagents', which call Toy Box tools too. */
  #turns = new Map<string, Pick<Turn, "id"> & { controller: AbortController; terminal?: string }>();
  #subagents = new Set<string>();
  #questions = new Map<string, PendingQuestion>();
  #disconnected = false;

  constructor(
    private readonly rpc: CodexTransport,
    readonly nativeId: string,
    private readonly configuration: SessionConfiguration,
    model: ModelConfiguration,
    private readonly skills: readonly SessionSkill[],
  ) {
    this.#model = model;
    this.#project = createCodexProjector(this.nativeId);
    this.#dispose = [
      rpc.onNotification((notification) => this.#notification(notification)),
      rpc.onRequest((request) => this.#request(request)),
      rpc.onClose(() => {
        this.#cancelRequests();
        this.#emit({ type: "end", reason: "error" });
      }),
    ];
  }

  onEvent(listener: (event: SessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async send(message: SessionMessage): Promise<void> {
    if (this.#disconnected)
      throw new SessionConnectionUnavailableError("Codex session disconnected.");
    const input = encodeInput(message, this.skills);
    if (message.immediate) {
      const turn = this.#turns.get(this.nativeId);
      if (!turn) throw new Error("The Codex turn has ended. Send this message as a new turn.");
      await this.rpc.request("turn/steer", {
        threadId: this.nativeId,
        expectedTurnId: turn.id,
        clientUserMessageId: message.clientId,
        input,
      });
    } else {
      await this.rpc.request("turn/start", {
        threadId: this.nativeId,
        clientUserMessageId: message.clientId,
        input,
        model: this.#model.name,
        effort: this.#model.reasoningEffort as ReasoningEffort | undefined,
        // Some Codex models default to no visible reasoning summaries.
        summary: "auto",
      });
    }
  }

  async setModel(model: ModelConfiguration): Promise<void> {
    this.#model = model;
  }

  async answerQuestion({ requestId, answer }: SessionQuestionAnswer): Promise<boolean> {
    const question = this.#questions.get(requestId);
    if (!question) return false;
    this.#questions.delete(requestId);
    const { batch } = question;
    batch.answers[question.id] = { answers: [answer] };
    this.#emit({ type: "question_resolved", toolCallId: question.toolCallId, answer });
    if (Object.keys(batch.answers).length === batch.size)
      this.rpc.respond(batch.rpcId, {
        answers: batch.answers,
      } satisfies ToolRequestUserInputResponse);
    return true;
  }

  /** Stop interrupts the session tree's running turns: the root's and its subagents'. */
  async abort(): Promise<void> {
    this.#cancelRequests();
    const turn = this.#turns.get(this.nativeId);
    if (turn)
      await this.rpc.request("turn/interrupt", {
        threadId: this.nativeId,
        turnId: turn.id,
      });
    const subagents = await this.#loadedSubagents();
    // Workaround (Codex CLI 0.166.0; listed in providers/AGENTS.md): an empty turn ID interrupts
    // whatever a subagent is running, so Stop needs no subagent turn tracking. Replace with
    // thread/interrupt (openai/codex#40953).
    await Promise.all(
      subagents.map((threadId) => this.rpc.request("turn/interrupt", { threadId, turnId: "" })),
    );
  }

  async disconnect(): Promise<void> {
    if (this.#disconnected) return;
    this.#disconnected = true;
    this.#cancelRequests();
    for (const dispose of this.#dispose) dispose();
    this.#listeners.clear();
    await this.rpc.request("thread/unsubscribe", { threadId: this.nativeId });
  }

  async rename(name: string, automatic?: true): Promise<boolean> {
    if (automatic) {
      const { thread } = await this.rpc.request("thread/read", {
        threadId: this.nativeId,
      });
      if (thread.name) return false;
    }
    await this.rpc.request("thread/name/set", { threadId: this.nativeId, name });
    return true;
  }

  async rewind(timestamp: string): Promise<void> {
    if (this.#turns.has(this.nativeId)) throw new Error("Stop the session before rewinding it.");
    const thread = await readThreadHistory(this.rpc, this.nativeId);
    const turn = thread.turns.find((turn) =>
      turn.items.some(
        (item, i) => item.type === "userMessage" && itemTimestamp(turn, i) === timestamp,
      ),
    );
    if (!turn) throw new Error("That message is no longer available to rewind.");
    const firstInput = turn.items.findIndex((item) => item.type === "userMessage");
    if (itemTimestamp(turn, firstInput) !== timestamp)
      throw new Error(
        "Codex can rewind to the start of a turn. Choose the first message in this turn.",
      );
    await this.rpc.request("thread/revert", { threadId: thread.id, beforeTurnId: turn.id });
    this.#project = createCodexProjector(this.nativeId);
  }

  #emit(event: SessionEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #fail(error: unknown): void {
    console.error("Codex session failed:", error);
    this.#emit({ type: "end", reason: "error" });
    void this.abort().catch(console.error);
  }

  /** Root turns drive bookkeeping, and direct subagent turns gate their Toy Box calls. The
   * projector routes this session's subagent threads into their agent cards. */
  #notification(notification: RpcNotification): void {
    const { method, params } = notification;
    if (!params || typeof params !== "object" || !("threadId" in params)) return;
    const { threadId } = params;
    const root = threadId === this.nativeId;
    switch (method) {
      case "turn/started": {
        if (!root && !this.#subagents.has(threadId)) break;
        this.#turns.set(threadId, { id: params.turn.id, controller: new AbortController() });
        if (root) this.#emit({ type: "model_changed", model: this.#model });
        break;
      }
      case "turn/completed": {
        // A subagent can outlive the root turn that spawned it, so each turn ends alone.
        const turn = this.#turns.get(threadId);
        if (turn?.id === params.turn.id) {
          turn.controller.abort();
          this.#turns.delete(threadId);
          if (root) this.#cancelQuestions();
        } else if (root) return;
        break;
      }
      case "serverRequest/resolved":
        if (root) this.#cancelQuestions(params.requestId);
        break;
      case "item/started":
      case "item/completed": {
        const subagent = root && subagentThreadId(params.item);
        if (subagent) this.#subagents.add(subagent);
        break;
      }
    }
    for (const event of this.#project(notification)) this.#emit(event);
    if (method === "item/completed") {
      const { item, turnId } = params;
      const turn = this.#turns.get(threadId);
      if (item.type === "dynamicToolCall" && item.id === turn?.terminal && turn.id === turnId) {
        void this.rpc.request("turn/interrupt", { threadId, turnId }).catch((error) => {
          if (this.#turns.get(threadId) === turn) this.#fail(error);
        });
      }
    }
  }

  /** Spawned subagents at any depth that are still loaded, and so may still be working. */
  async #loadedSubagents(): Promise<string[]> {
    const loaded: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ThreadListResponse = await this.rpc.request("thread/list", {
        cursor,
        limit: 100,
        ancestorThreadId: this.nativeId,
        sourceKinds: ["subAgentThreadSpawn"],
        useStateDbOnly: true,
      });
      for (const { id, status } of page.data) if (status.type !== "notLoaded") loaded.push(id);
      cursor = page.nextCursor;
    } while (cursor);
    return loaded;
  }

  #request(request: RpcRequest): boolean {
    // JSON-RPC allows omitted params; unknown requests must decline rather than throw.
    const threadId = request.params?.threadId;
    const root = threadId === this.nativeId;
    if (request.method === "item/tool/call") {
      const { params } = request;
      if (params.namespace !== "toy_box" || !(root || this.#subagents.has(threadId))) return false;
      void this.#callTool(request.id, params).catch((error) => this.#fail(error));
      return true;
    }
    // Questions belong to the root thread, where the session can present them.
    if (root && request.method === "item/tool/requestUserInput") {
      const { itemId, questions, isBlocking } = request.params;
      if (!questions.length) {
        this.rpc.respond(request.id, { answers: {} });
        return true;
      }
      const batch = { rpcId: request.id, size: questions.length, answers: {} };
      for (const native of questions) {
        const requestId = `codex:${request.id}:${native.id}`;
        const toolCallId = `${itemId}:${native.id}`;
        const question = {
          question: native.question,
          choices: native.options?.map((option) => option.label),
          allowFreeform: native.isOther || !native.options?.length,
          blocking: isBlocking,
          secret: native.isSecret,
        };
        this.#questions.set(requestId, { id: native.id, toolCallId, batch });
        this.#emit({
          type: "tool_start",
          toolCallId,
          toolName: "ask_user",
          arguments: {},
          question,
        });
        this.#emit({ type: "question_requested", toolCallId, requestId, question });
      }
      return true;
    }
    // The configured trusted-server policy should suppress native approvals.
    // Unknown requests are explicitly rejected by the transport, never left hanging.
    return false;
  }

  async #callTool(
    id: string | number,
    { threadId, turnId, tool: name, arguments: args, callId }: DynamicToolCallParams,
  ): Promise<void> {
    const turn = this.#turns.get(threadId);
    let success = true;
    let text: string;
    try {
      if (turn?.id !== turnId) throw new Error("This turn has already ended.");
      if (turn.terminal) throw new Error("This turn has already completed its terminal action.");
      const signal = turn.controller.signal;
      signal.throwIfAborted();
      const tool = this.configuration.tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Tool ${name} is unavailable in this session.`);
      text = await tool.handler(args);
      signal.throwIfAborted();
      if (tool.isTerminal) turn.terminal = callId;
    } catch (error) {
      success = false;
      text = error instanceof Error ? error.message : String(error);
    }
    this.rpc.respond(id, {
      success,
      contentItems: [{ type: "inputText", text }],
    } satisfies DynamicToolCallResponse);
  }

  /** Unanswered questions end with their native request, or with every request when omitted. */
  #cancelQuestions(rpcId?: string | number): void {
    for (const [requestId, question] of this.#questions) {
      if (rpcId !== undefined && question.batch.rpcId !== rpcId) continue;
      this.#questions.delete(requestId);
      this.#emit({ type: "question_cancelled", toolCallId: question.toolCallId });
    }
  }

  #cancelRequests(): void {
    for (const turn of this.#turns.values()) turn.controller.abort();
    this.#cancelQuestions();
  }
}
