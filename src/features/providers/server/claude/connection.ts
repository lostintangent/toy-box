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
import type { Session, SessionEvent, SessionMessage } from "@sessions/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import {
  SessionConnectionUnavailableError,
  type SessionConfiguration,
  type SessionConnection,
} from "@providers/server/provider";
import { closeClaudeQuery, startClaudeQuery } from "./client";
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
  #pendingInputs = new Map<string, string>();
  #questions = new Map<string, (answer: string | undefined) => void>();
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
        // Native idle must include background agents and their completion notifications.
        env: {
          ...process.env,
          CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
          CLAUDE_CODE_BG_TASKS_REPORT_RUNNING: "1",
        },
        includePartialMessages: true,
        // Newer models omit visible thinking summaries unless explicitly requested.
        thinking: { type: "adaptive", display: "summarized" },
        forwardSubagentText: true,
        skills: "all",
        plugins: configuration.skillDirectories.map((path) => ({ type: "local", path })),
        systemPrompt: { type: "preset", preset: "claude_code", append: configuration.instructions },
        ...(configuration.disableMemory ? { settings: { autoMemoryEnabled: false } } : {}),
        extraArgs: { "replay-user-messages": null },
        // Newer models omit native checklist tools unless explicitly enabled.
        allowedTools: ["TodoWrite", "TaskCreate", "TaskGet", "TaskUpdate", "TaskList"],
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
    // "next" folds steering into the active turn; "now" aborts that turn. Claude folds it in as
    // text only, so an immediate message with images waits for the turn to end ("later").
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

  async abort(): Promise<void> {
    await this.#native?.interrupt();
  }

  async disconnect(): Promise<void> {
    if (!this.#native) return;
    const native = this.#native;
    this.#native = undefined;
    for (const resolve of this.#questions.values()) resolve(undefined);
    this.#pendingInputs.clear();
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
    try {
      for await (const message of native) {
        for (const projected of project(message)) {
          if (
            (projected.type === "user_message" || projected.type === "system_message") &&
            message.type === "user" &&
            message.uuid
          ) {
            const clientId = this.#pendingInputs.get(message.uuid);
            // Native local-command output and automatic prompts are not owner messages.
            if (!clientId) continue;
            this.#pendingInputs.delete(message.uuid);
            this.#emit({ ...projected, clientId });
          } else if (projected.type === "model_changed" && !projected.parentToolCallId) {
            this.#emit({
              ...projected,
              model: { ...projected.model, reasoningEffort: this.#reasoningEffort },
            });
          } else this.#emit(projected);
        }
      }
      if (this.#native === native)
        this.#emit({ type: "end", reason: "error", error: "Claude Agent disconnected." });
    } catch (error) {
      if (this.#native === native)
        this.#emit({ type: "end", reason: "error", error: String(error) });
    } finally {
      if (this.#native === native) await this.disconnect();
    }
  }

  #canUseTool(allowQuestions: boolean): CanUseTool {
    return async (name, input, { signal, toolUseID }) => {
      if (name !== "AskUserQuestion") return { behavior: "allow", updatedInput: input };
      if (!allowQuestions)
        return {
          behavior: "deny",
          message: "User questions are unavailable. Continue using your best judgment.",
        };
      const questions = claudeQuestions(input as unknown as AskUserQuestionInput);
      const answers = await Promise.all(
        questions.map(async (question, index) => {
          const id = `${toolUseID}:${index}`;
          const answer = await new Promise<string | undefined>((resolve) => {
            const finish = (value: string | undefined) => {
              this.#questions.delete(id);
              signal.removeEventListener("abort", cancel);
              resolve(value);
            };
            const cancel = () => finish(undefined);
            this.#questions.set(id, finish);
            if (signal.aborted) {
              cancel();
              return;
            }
            signal.addEventListener("abort", cancel, { once: true });
            this.#emit({ type: "question_requested", requestId: id, toolCallId: id, question });
          });
          this.#emit(
            answer === undefined
              ? { type: "question_cancelled", toolCallId: id }
              : { type: "question_resolved", toolCallId: id, answer },
          );
          return answer;
        }),
      );
      if (answers.some((answer) => answer === undefined))
        return { behavior: "deny", message: "The user cancelled the question." };
      return {
        behavior: "allow",
        updatedInput: {
          ...input,
          answers: Object.fromEntries(
            questions.map((question, index) => [question.question, answers[index]]),
          ),
        },
      };
    };
  }

  #emit(event: SessionEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
