// Providers adapt native histories and live activity to Sessions' domain model.
// Sessions supplies host policy and resources, and owns queues and completion.

import type { ModelConfiguration, ModelInfo } from "@providers/model";
import type { SessionEvent, SessionMessage, Session, SessionSkill } from "@sessions/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import type { Tool } from "@sessions/server/tools/definition";

/** The operation was not submitted; reacquiring the connection is safe. */
export class SessionConnectionUnavailableError extends Error {}

export type SessionConfiguration = {
  model?: ModelConfiguration;
  directory: string;
  allowUserQuestions: boolean;
  tools: Tool<any>[];
  instructions: string;
  skillDirectories: string[];
  disableMemory?: boolean;
};

/** One attached native session, independent of browser observation. */
export interface SessionConnection {
  readonly provider: NonNullable<Session["provider"]>;
  /** The runtime consumes end to drain queued work before publishing completion. */
  onEvent(listener: (event: SessionEvent) => void): () => void;
  send(message: SessionMessage): Promise<void>;
  setModel(model: ModelConfiguration): Promise<void>;
  answerQuestion(answer: SessionQuestionAnswer): Promise<boolean>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  rename(name: string, automatic?: true): Promise<boolean>;
  rewind(timestamp: string): Promise<void>;
}

/** Providers reuse the supplied session ID when supported; native overrides remain opaque. */
export interface SessionProvider {
  readonly id: string;
  readonly name: string;
  listModels(): Promise<ModelInfo[]>;
  listSkills(
    directory: string | undefined,
    skillDirectories: readonly string[],
  ): Promise<SessionSkill[]>;
  listSessions(): Promise<Session[]>;
  /** Read durable history without resuming or acquiring the native session. */
  readHistory(session: Pick<Session, "id" | "provider">): Promise<SessionEvent[]>;
  create(
    sessionId: string,
    configuration: SessionConfiguration & { name?: string },
  ): Promise<SessionConnection>;
  resume(
    session: Pick<Session, "id" | "provider">,
    configuration: SessionConfiguration,
  ): Promise<SessionConnection>;
  readDirectory(nativeId: string): Promise<string | undefined>;
  /** The provider owns persistence precision and any trailing-flush policy. */
  isHistoryCurrent(nativeId: string, capturedAt: number): Promise<boolean>;
  delete(nativeId: string): Promise<void>;
  stop(): Promise<void>;
}
