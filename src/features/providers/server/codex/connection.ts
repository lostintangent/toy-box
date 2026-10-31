import { SessionConnectionUnavailableError } from "@providers/server/provider";
import type { ModelConfiguration } from "@providers/model";
import type { Session, SessionEvent, SessionMessage, SessionSkill } from "@sessions/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import type { SessionConfiguration, SessionConnection } from "@providers/server/provider";
import { normalizeToolResult, type ToolResult } from "@sessions/server/tools/definition";
import type {
  DynamicToolCallParams,
  DynamicToolCallResponse,
  ThreadListResponse,
  ToolRequestUserInputResponse,
  Turn,
  ReasoningEffort,
} from "./protocol";
import { CodexTransport, type RpcNotification, type RpcRequest } from "./protocol/transport";
import { createCodexProjector, itemTimestamp } from "./projector";
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
  readonly provider: { id: string; sessionId: string };
  private readonly sessionId: string;
  #listeners = new Set<(event: SessionEvent) => void>();
  #dispose: (() => void)[];
  #project: ReturnType<typeof createCodexProjector>;
  #model: ModelConfiguration;
  #turn?: Pick<Turn, "id"> & { controller: AbortController };
  #questions = new Map<string, PendingQuestion>();
  #terminal?: { turnId: string; callId: string };
  #disconnected = false;

  constructor(
    private readonly rpc: CodexTransport,
    session: Pick<Session, "id" | "provider">,
    private readonly configuration: SessionConfiguration,
    model: ModelConfiguration,
    private readonly skills: readonly SessionSkill[],
  ) {
    this.sessionId = session.id;
    this.provider = { id: "codex", sessionId: session.provider?.sessionId ?? session.id };
    this.#model = model;
    this.#project = createCodexProjector(session.id, this.provider.sessionId);
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
      if (!this.#turn)
        throw new Error("The Codex turn has ended. Send this message as a new turn.");
      await this.rpc.request("turn/steer", {
        threadId: this.provider.sessionId,
        expectedTurnId: this.#turn.id,
        clientUserMessageId: message.clientId,
        input,
      });
    } else {
      await this.rpc.request("turn/start", {
        threadId: this.provider.sessionId,
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
    if (this.#turn)
      await this.rpc.request("turn/interrupt", {
        threadId: this.provider.sessionId,
        turnId: this.#turn.id,
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
    await this.rpc.request("thread/unsubscribe", { threadId: this.provider.sessionId });
  }

  async rename(name: string, automatic?: true): Promise<boolean> {
    if (automatic) {
      const { thread } = await this.rpc.request("thread/read", {
        threadId: this.provider.sessionId,
      });
      if (thread.name) return false;
    }
    await this.rpc.request("thread/name/set", { threadId: this.provider.sessionId, name });
    return true;
  }

  async rewind(timestamp: string): Promise<void> {
    if (this.#turn) throw new Error("Stop the session before rewinding it.");
    const thread = await readThreadHistory(this.rpc, this.provider.sessionId);
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
    this.#project = createCodexProjector(this.sessionId, this.provider.sessionId);
  }

  #emit(event: SessionEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #fail(error: unknown): void {
    console.error("Codex session failed:", error);
    this.#emit({ type: "end", reason: "error" });
    void this.abort().catch(console.error);
  }

  /** Root turns drive bookkeeping; the projector also routes this session's subagent threads. */
  #notification(notification: RpcNotification): void {
    const { method, params } = notification;
    if (!params || typeof params !== "object" || !("threadId" in params)) return;
    if (params.threadId === this.provider.sessionId) {
      switch (method) {
        case "turn/started": {
          const { turn } = params;
          this.#turn = { id: turn.id, controller: new AbortController() };
          this.#emit({ type: "model_changed", model: this.#model });
          break;
        }
        case "turn/completed": {
          const { turn } = params;
          if (this.#turn?.id !== turn.id) return;
          this.#cancelRequests();
          this.#turn = undefined;
          break;
        }
        case "serverRequest/resolved": {
          const { requestId } = params;
          this.#cancelQuestions(requestId);
          break;
        }
      }
    }
    for (const event of this.#project(notification)) this.#emit(event);
    if (method === "item/completed") {
      const { item, turnId } = params;
      const terminal = this.#terminal;
      if (
        item.type === "dynamicToolCall" &&
        item.id === terminal?.callId &&
        turnId === terminal.turnId &&
        this.#turn?.id === turnId
      ) {
        void this.rpc
          .request("turn/interrupt", { threadId: this.provider.sessionId, turnId })
          .catch((error) => {
            if (this.#turn?.id === turnId) this.#fail(error);
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
        ancestorThreadId: this.provider.sessionId,
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
    if (request.params?.threadId !== this.provider.sessionId) return false;
    if (request.method === "item/tool/call") {
      const { params } = request;
      if (params.namespace !== "toy_box") return false;
      void this.#callTool(request.id, params).catch((error) => this.#fail(error));
      return true;
    }
    if (request.method === "item/tool/requestUserInput") {
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
    { tool: name, arguments: args, callId }: DynamicToolCallParams,
  ): Promise<void> {
    const turn = this.#turn;
    let result: ToolResult;
    try {
      if (!turn || this.#terminal?.turnId === turn.id)
        throw new Error("This turn has already completed its terminal action.");
      const signal = turn.controller.signal;
      signal.throwIfAborted();
      const tool = this.configuration.tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Tool ${name} is unavailable in this session.`);
      const parsed = tool.parameters ? tool.parameters.parse(args) : args;
      result = normalizeToolResult(await tool.handler(parsed, this.sessionId));
      signal.throwIfAborted();
      if (tool.isTerminal && !result.isError) this.#terminal = { turnId: turn.id, callId };
    } catch (error) {
      result = {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
    this.rpc.respond(id, {
      success: !result.isError,
      contentItems: result.content.map((content) =>
        content.type === "text"
          ? { type: "inputText", text: content.text }
          : { type: "inputImage", imageUrl: `data:${content.mimeType};base64,${content.data}` },
      ),
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
    this.#turn?.controller.abort();
    this.#cancelQuestions();
  }
}
