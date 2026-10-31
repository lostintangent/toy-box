import {
  getSessionInfo,
  renameSession,
  type CanUseTool,
  type EffortLevel,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import type { ModelConfiguration } from "@providers/model";
import type { Session, SessionEvent, SessionMessage, SessionQuestionBase } from "@sessions/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import {
  SessionConnectionUnavailableError,
  type SessionConfiguration,
  type SessionConnection,
} from "@providers/server/provider";
import { claudeSkillPlugins, closeClaudeQuery, startClaudeQuery } from "./client";
import { encodeInput } from "./messages";
import { createClaudeTools } from "./tools";
import { claudeQuestions, createClaudeProjector } from "./projector";

/** One SDK query per attached session. Sessions owns the queue and browser lifetimes. */
export class ClaudeConnection implements SessionConnection {
  readonly provider: { id: string; sessionId: string };
  private readonly sessionId: string;
  #native: Query | undefined;
  #input!: ReadableStreamDefaultController<SDKUserMessage>;
  #listeners = new Set<(event: SessionEvent) => void>();
  // Sends awaiting their native replay: native message id to Toy Box clientId.
  #pendingInputs = new Map<string, string>();
  #questions = new Map<string, (answer: string | undefined) => void>();
  // Native frames omit effort, so live model changes carry the last one applied.
  #reasoningEffort: ModelConfiguration["reasoningEffort"];

  private constructor(
    session: Pick<Session, "id" | "provider">,
    configuration: SessionConfiguration & { name?: string },
    resume: boolean,
  ) {
    this.sessionId = session.id;
    this.provider = { id: "claude", sessionId: session.provider?.sessionId ?? session.id };
    this.#reasoningEffort = configuration.model?.reasoningEffort;
    const prompt = new ReadableStream<SDKUserMessage>({
      start: (controller) => {
        this.#input = controller;
      },
    });
    this.#native = startClaudeQuery(
      {
        ...(resume ? { resume: this.provider.sessionId } : { sessionId: this.provider.sessionId }),
        cwd: configuration.directory,
        title: configuration.name,
        model: configuration.model?.name,
        effort: configuration.model?.reasoningEffort as EffortLevel | undefined,
        // Native idle ends work, and newer models omit native checklist tools unless enabled.
        env: {
          ...process.env,
          CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
          CLAUDE_CODE_ENABLE_TODO_TOOLS: "1",
        },
        includePartialMessages: true,
        // Newer models omit visible thinking summaries unless explicitly requested.
        thinking: { type: "adaptive", display: "summarized" },
        forwardSubagentText: true,
        skills: "all",
        plugins: claudeSkillPlugins(configuration.directory, configuration.skillDirectories),
        systemPrompt: { type: "preset", preset: "claude_code", append: configuration.instructions },
        // History reads across compactions, so long conversations compact as they do with Codex and
        // Copilot, whatever the owner's Claude setting.
        settings: {
          autoCompactEnabled: true,
          ...(configuration.disableMemory ? { autoMemoryEnabled: false } : {}),
        },
        extraArgs: { "replay-user-messages": null },
        // Pinned so the owner's native default or auto mode can't bypass Toy Box's canUseTool policy.
        permissionMode: "default",
        canUseTool: this.#canUseTool(configuration.allowUserQuestions),
        mcpServers: {
          toy_box: createClaudeTools(this.sessionId, configuration.tools),
        },
      },
      prompt,
    );
  }

  static async open(
    session: Pick<Session, "id" | "provider">,
    configuration: SessionConfiguration & { name?: string },
    resume = false,
  ): Promise<ClaudeConnection> {
    const connection = new ClaudeConnection(session, configuration, resume);
    try {
      await connection.#native!.initializationResult();
      void connection.#read(connection.#native!);
      return connection;
    } catch (error) {
      await connection.disconnect();
      throw error;
    }
  }

  onEvent(listener: (event: SessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async send(message: SessionMessage): Promise<void> {
    if (!this.#native) throw new SessionConnectionUnavailableError("Claude Agent disconnected.");
    const content = encodeInput(message);
    // "next" folds steering into the active turn at its next model step, but as text only, so an
    // immediate message with images waits for the turn to end ("later") rather than lose them.
    const hasImages = message.role === "user" && Boolean(message.attachments?.length);
    const uuid = crypto.randomUUID();
    this.#pendingInputs.set(uuid, message.clientId);
    this.#input.enqueue({
      type: "user",
      uuid,
      session_id: this.provider.sessionId,
      parent_tool_use_id: null,
      message: { role: "user", content },
      ...(message.role === "user" ? { origin: { kind: "human" } as const } : {}),
      ...(message.immediate
        ? { priority: hasImages ? ("later" as const) : ("next" as const) }
        : {}),
    });
  }

  async setModel(model: ModelConfiguration): Promise<void> {
    if (!this.#native) throw new SessionConnectionUnavailableError("Claude Agent disconnected.");
    await this.#native.applyFlagSettings({
      model: model.name,
      effortLevel: (model.reasoningEffort as EffortLevel | undefined) ?? null,
    });
    this.#reasoningEffort = model.reasoningEffort;
  }

  async answerQuestion({ requestId, answer }: SessionQuestionAnswer): Promise<boolean> {
    const resolve = this.#questions.get(requestId);
    if (!resolve) return false;
    resolve(answer);
    return true;
  }

  /** Stops the turn and cancels the steers it has not reached. */
  async abort(): Promise<void> {
    // Workaround (Claude Agent SDK 0.3.314; listed in providers/AGENTS.md): `Query.interrupt()`
    // sends `cancelQueued` as the protocol's `cancel_queued`, but its type omits the option.
    // @ts-expect-error
    await this.#native?.interrupt({ cancelQueued: true });
  }

  async disconnect(): Promise<void> {
    if (!this.#native) return;
    const native = this.#native;
    this.#native = undefined;
    this.#input.close();
    await closeClaudeQuery(native);
  }

  async rename(name: string, automatic?: true): Promise<boolean> {
    if (automatic && (await getSessionInfo(this.provider.sessionId))?.customTitle) return false;
    await renameSession(this.provider.sessionId, name);
    return true;
  }

  async rewind(_timestamp: string): Promise<void> {
    throw new Error("Claude Agent does not support in-place conversation rewind.");
  }

  async #read(native: Query): Promise<void> {
    const project = createClaudeProjector(this.sessionId);
    let error = "Claude Agent disconnected.";
    try {
      for await (const message of native) {
        // The projector alone decides what is transcript; replays of sends carry their clientId.
        let clientId: string | undefined;
        if (message.type === "user" && message.uuid) {
          clientId = this.#pendingInputs.get(message.uuid);
          this.#pendingInputs.delete(message.uuid);
        }
        const events = project(message);
        for (const projected of events) {
          if (
            clientId &&
            (projected.type === "user_message" || projected.type === "system_message")
          )
            this.#emit({ ...projected, clientId });
          else if (projected.type === "model_changed" && !projected.parentToolCallId) {
            this.#emit({
              ...projected,
              model: { ...projected.model, reasoningEffort: this.#reasoningEffort },
            });
          } else this.#emit(projected);
        }
        // A turn whose result cannot report the context, such as `/compact`, is measured before
        // native idle ends it. Failed and stopped turns have already ended.
        if (
          message.type === "result" &&
          !message.is_error &&
          !events.some(({ type }) => type === "context_usage_changed")
        )
          await this.#measureContext(native);
      }
    } catch (failure) {
      error = String(failure);
    }
    // disconnect() clears #native first, so only a native process that ended on its own fails.
    if (this.#native !== native) return;
    this.#emit({ type: "end", reason: "error", error });
    await this.disconnect();
  }

  /** The CLI counts its context with the token-count API; its estimates miss after compaction. */
  async #measureContext(native: Query): Promise<void> {
    const usage = await native.getContextUsage({ detail: "full" }).catch(() => undefined);
    if (usage)
      this.#emit({
        type: "context_usage_changed",
        usage: { tokens: usage.totalTokens, tokenWindow: usage.maxTokens },
      });
  }

  #canUseTool(allowQuestions: boolean): CanUseTool {
    return async (name, input, { signal, toolUseID }) => {
      if (name !== "AskUserQuestion") return { behavior: "allow", updatedInput: input };
      if (!allowQuestions)
        return {
          behavior: "deny",
          message: "User questions are unavailable. Continue using your best judgment.",
        };
      const questions = claudeQuestions(toolUseID, input as unknown as AskUserQuestionInput);
      const answers = await Promise.all(
        questions.map(({ toolCallId, question }) => this.#ask(toolCallId, question, signal)),
      );
      if (answers.some((answer) => answer === undefined))
        return { behavior: "deny", message: "The user cancelled the question." };
      return {
        behavior: "allow",
        updatedInput: {
          ...input,
          answers: Object.fromEntries(
            questions.map(({ question }, index) => [question.question, answers[index]]),
          ),
        },
      };
    };
  }

  /** Resolves with the owner's answer, or undefined once the turn stops or disconnects. */
  async #ask(
    toolCallId: string,
    question: SessionQuestionBase,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const answer = await new Promise<string | undefined>((resolve) => {
      const finish = (value: string | undefined) => {
        this.#questions.delete(toolCallId);
        signal.removeEventListener("abort", cancel);
        resolve(value);
      };
      const cancel = () => finish(undefined);
      if (signal.aborted) return cancel();
      this.#questions.set(toolCallId, finish);
      signal.addEventListener("abort", cancel, { once: true });
      this.#emit({ type: "question_requested", requestId: toolCallId, toolCallId, question });
    });
    this.#emit(
      answer === undefined
        ? { type: "question_cancelled", toolCallId }
        : { type: "question_resolved", toolCallId, answer },
    );
    return answer;
  }

  #emit(event: SessionEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
