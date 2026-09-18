import { SessionConnectionUnavailableError } from "@providers/server/provider";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import type { SessionEvent, SessionMessage, SessionSkill } from "@sessions/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import type {
  SessionIdentity,
  SessionConfiguration,
  SessionConnection,
} from "@providers/server/provider";
import { normalizeToolResult, type ToolResult } from "@sessions/server/tools/definition";
import type {
  DynamicToolCallParams,
  DynamicToolCallResponse,
  ItemCompletedNotification,
  ServerRequestResolvedNotification,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
  Turn,
  TurnCompletedNotification,
  TurnStartedNotification,
  ReasoningEffort,
} from "./protocol";
import { CodexTransport, type RpcNotification, type RpcRequest } from "./protocol/transport";
import {
  createCodexProjector,
  codexQuestionId,
  isCodexSubagentSpawn,
  itemTimestamp,
  scopeCodexSubagentEvent,
} from "./projector";
import { encodeInput } from "./inputs";
import { readThreadHistory } from "./history";

type PendingQuestion = {
  rpcId: string | number;
  params: ToolRequestUserInputParams;
  answers: ToolRequestUserInputResponse["answers"];
};

type SubagentProjection = {
  call: {
    toolCallId: string;
    remainingThreadIds: Set<string>;
    failed: boolean;
    error?: string;
  };
  project: ReturnType<typeof createCodexProjector>;
};

export class CodexConnection implements SessionConnection {
  readonly identity: SessionIdentity;
  #listeners = new Set<(event: SessionEvent) => void>();
  #dispose: (() => void)[];
  #project: ReturnType<typeof createCodexProjector>;
  #model: ModelConfiguration;
  #turn?: Pick<Turn, "id"> & { controller: AbortController };
  #questions = new Map<string, PendingQuestion>();
  #subagents = new Map<string, SubagentProjection>();
  #terminalTurn?: string;
  #terminalCallId?: string;
  #disconnected = false;

  constructor(
    private readonly rpc: CodexTransport,
    identity: SessionIdentity,
    private readonly configuration: SessionConfiguration,
    model: ModelConfiguration,
    private readonly skills: readonly SessionSkill[],
  ) {
    this.identity = identity;
    this.#model = model;
    this.#project = createCodexProjector(identity.sessionId);
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
    const input = await encodeInput(this.configuration.attachmentsDirectory, message, this.skills);
    if (message.immediate) {
      if (!this.#turn)
        throw new Error("The Codex turn has ended. Send this message as a new turn.");
      await this.rpc.request("turn/steer", {
        threadId: this.identity.nativeId,
        expectedTurnId: this.#turn.id,
        clientUserMessageId: message.clientId,
        input,
      });
    } else {
      this.#terminalTurn = undefined;
      await this.rpc.request("turn/start", {
        threadId: this.identity.nativeId,
        clientUserMessageId: message.clientId,
        input,
        model: this.#model.name,
        effort: this.#model.reasoningEffort as ReasoningEffort | undefined,
      });
    }
  }

  async setModel(model: ModelConfiguration): Promise<void> {
    this.#model = model;
  }

  async answerQuestion({ requestId, answer }: SessionQuestionAnswer): Promise<boolean> {
    const pending = this.#questions.get(requestId);
    if (!pending) return false;
    const question = pending.params.questions.find(
      (candidate) => codexQuestionId(pending.rpcId, candidate.id) === requestId,
    );
    if (!question || Object.hasOwn(pending.answers, question.id)) return false;
    pending.answers[question.id] = { answers: [answer] };
    this.#emit({
      type: "question_resolved",
      toolCallId: `${pending.params.itemId}:${question.id}`,
      answer,
    });
    if (Object.keys(pending.answers).length === pending.params.questions.length) {
      this.rpc.respond(pending.rpcId, {
        answers: pending.answers,
      } satisfies ToolRequestUserInputResponse);
      for (const question of pending.params.questions)
        this.#questions.delete(codexQuestionId(pending.rpcId, question.id));
    }
    return true;
  }

  async abort(): Promise<void> {
    this.#cancelRequests();
    if (this.#turn)
      await this.rpc.request("turn/interrupt", {
        threadId: this.identity.nativeId,
        turnId: this.#turn.id,
      });
  }

  async disconnect(): Promise<void> {
    if (this.#disconnected) return;
    this.#disconnected = true;
    this.#cancelRequests();
    for (const dispose of this.#dispose) dispose();
    this.#listeners.clear();
    this.#subagents.clear();
    await this.rpc.request("thread/unsubscribe", { threadId: this.identity.nativeId });
  }

  async rename(name: string, automatic?: true): Promise<boolean> {
    if (automatic) {
      const { thread } = await this.rpc.request("thread/read", {
        threadId: this.identity.nativeId,
      });
      if (thread.name) return false;
    }
    await this.rpc.request("thread/name/set", { threadId: this.identity.nativeId, name });
    return true;
  }

  async rewind(timestamp: string): Promise<void> {
    if (this.#turn) throw new Error("Stop the session before rewinding it.");
    const thread = await readThreadHistory(this.rpc, this.identity.nativeId);
    const index = thread.turns.findIndex((turn) =>
      turn.items.some(
        (item, i) => item.type === "userMessage" && itemTimestamp(turn, i) === timestamp,
      ),
    );
    if (index < 0) throw new Error("That message is no longer available to rewind.");
    const turn = thread.turns[index]!;
    const firstInput = turn.items.findIndex((item) => item.type === "userMessage");
    if (itemTimestamp(turn, firstInput) !== timestamp)
      throw new Error(
        "Codex can rewind to the start of a turn. Choose the first message in this turn.",
      );
    if (thread.historyMode === "paginated")
      await this.rpc.request("thread/revert", { threadId: thread.id, beforeTurnId: turn.id });
    else
      await this.rpc.request("thread/rollback", {
        threadId: thread.id,
        numTurns: thread.turns.length - index,
      });
    this.#project = createCodexProjector(this.identity.sessionId);
    this.#subagents.clear();
  }

  #emit(event: SessionEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #fail(error: unknown): void {
    console.error("Codex session failed:", error);
    this.#emit({ type: "end", reason: "error" });
    void this.abort().catch(console.error);
  }

  #notification(notification: RpcNotification): void {
    const { method, params } = notification;
    if (!params || typeof params !== "object" || !("threadId" in params)) return;
    const threadId = params.threadId;
    if (typeof threadId !== "string") return;
    if (threadId !== this.identity.nativeId) {
      this.#subagentNotification(threadId, notification);
      return;
    }
    switch (method) {
      case "turn/started": {
        const { turn } = params as TurnStartedNotification;
        this.#turn = { id: turn.id, controller: new AbortController() };
        this.#emit({ type: "model_changed", model: this.#model });
        break;
      }
      case "turn/completed": {
        const { turn } = params as TurnCompletedNotification;
        if (this.#turn?.id !== turn.id) return;
        this.#cancelRequests();
        this.#turn = undefined;
        break;
      }
      case "serverRequest/resolved": {
        const { requestId } = params as ServerRequestResolvedNotification;
        this.#clearQuestions(requestId);
        break;
      }
    }
    this.#registerSubagent(notification);
    for (const event of this.#project(notification)) this.#emit(event);
    if (method === "item/completed") {
      const { item, turnId } = params as ItemCompletedNotification;
      if (
        item.type === "dynamicToolCall" &&
        item.id === this.#terminalCallId &&
        this.#terminalTurn === turnId &&
        this.#turn?.id === turnId
      ) {
        void this.rpc
          .request("turn/interrupt", { threadId: this.identity.nativeId, turnId })
          .catch((error) => {
            if (this.#turn?.id === turnId) this.#fail(error);
          });
      }
    }
  }

  #registerSubagent(notification: RpcNotification): void {
    if (notification.method !== "item/completed") return;
    const { item } = notification.params as ItemCompletedNotification;
    if (!isCodexSubagentSpawn(item) || item.status !== "completed") return;

    const threadIds = item.receiverThreadIds;
    if (!threadIds.length) return;
    const call = {
      toolCallId: item.id,
      remainingThreadIds: new Set(threadIds),
      failed: false,
    };
    for (const threadId of threadIds) {
      this.#subagents.set(threadId, {
        call,
        project: createCodexProjector(this.identity.sessionId),
      });
    }
  }

  #subagentNotification(threadId: string, notification: RpcNotification): void {
    const subagent = this.#subagents.get(threadId);
    if (!subagent) return;

    for (const event of subagent.project(notification)) {
      if (event.type === "end") {
        this.#completeSubagent(threadId, subagent, event);
        continue;
      }
      const scoped = scopeCodexSubagentEvent(event, subagent.call.toolCallId);
      if (scoped) this.#emit(scoped);
    }
  }

  #completeSubagent(
    threadId: string,
    subagent: SubagentProjection,
    event: Extract<SessionEvent, { type: "end" }>,
  ): void {
    this.#subagents.delete(threadId);
    const { call } = subagent;
    call.remainingThreadIds.delete(threadId);
    if (event.reason === "error") {
      call.failed = true;
      call.error ??= event.error;
    }
    if (call.remainingThreadIds.size) return;

    this.#emit({
      type: "tool_end",
      toolCallId: call.toolCallId,
      success: !call.failed,
      ...(call.error ? { result: call.error } : {}),
    });
  }

  #request(request: RpcRequest): boolean {
    if (
      !request.params ||
      typeof request.params !== "object" ||
      !("threadId" in request.params) ||
      request.params.threadId !== this.identity.nativeId
    )
      return false;
    if (request.method === "item/tool/call") {
      const params = request.params as DynamicToolCallParams;
      if (params.namespace !== "toy_box") return false;
      void this.#callTool(request.id, params).catch((error) => this.#fail(error));
      return true;
    }
    if (request.method === "item/tool/requestUserInput") {
      const params = request.params as ToolRequestUserInputParams;
      if (!params.questions.length) {
        this.rpc.respond(request.id, { answers: {} });
        return true;
      }
      const pending: PendingQuestion = {
        rpcId: request.id,
        params,
        answers: {},
      };
      for (const question of params.questions) {
        this.#questions.set(codexQuestionId(request.id, question.id), pending);
      }
      for (const event of this.#project(request)) this.#emit(event);
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
      if (!turn || this.#terminalTurn === turn.id)
        throw new Error("This turn has already completed its terminal action.");
      const signal = turn.controller.signal;
      signal.throwIfAborted();
      const tool = this.configuration.tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Tool ${name} is unavailable in this session.`);
      const parsed = tool.parameters ? tool.parameters.parse(args) : args;
      result = normalizeToolResult(
        await tool.handler(parsed, {
          sessionId: this.identity.sessionId,
          toolCallId: callId,
          toolName: name,
          arguments: args,
          signal,
        }),
      );
      signal.throwIfAborted();
      if (tool.isTerminal && !result.isError) {
        this.#terminalTurn = turn.id;
        this.#terminalCallId = callId;
      }
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

  #clearQuestions(rpcId: string | number): void {
    for (const [id, pending] of this.#questions) {
      if (pending.rpcId !== rpcId) continue;
      const question = pending.params.questions.find(
        (question) => codexQuestionId(rpcId, question.id) === id,
      )!;
      if (!Object.hasOwn(pending.answers, question.id)) {
        this.#emit({
          type: "question_cancelled",
          toolCallId: `${pending.params.itemId}:${question.id}`,
        });
      }
      this.#questions.delete(id);
    }
  }

  #cancelRequests(): void {
    this.#turn?.controller.abort();
    for (const pending of new Set(this.#questions.values())) this.#clearQuestions(pending.rpcId);
  }
}
