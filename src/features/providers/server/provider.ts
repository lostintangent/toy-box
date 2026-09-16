// Providers adapt native histories and live activity to Sessions' domain model.
// Sessions supplies host policy and resources, and owns queues and completion.

import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import type {
  ModelInfo,
  QueuedMessage,
  SessionEvent,
  SessionMetadata,
  SessionSkill,
} from "@sessions/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import type { Tool } from "@sessions/server/tools/definition";

/** The operation was not submitted; reacquiring the connection is safe. */
export class SessionConnectionUnavailableError extends Error {}

export type SessionIdentity = {
  sessionId: string;
  providerId: string;
  nativeId: string;
};

export type SessionConfiguration = {
  model?: ModelConfiguration;
  directory: string;
  allowUserQuestions: boolean;
  tools: Tool<any>[];
  instructions: string;
  skillDirectories: string[];
  attachmentsDirectory: string;
  disableMemory?: boolean;
};

/** One attached native session, independent of browser observation. */
export interface SessionConnection {
  readonly identity: SessionIdentity;
  /** The runtime consumes end to drain queued work before publishing completion. */
  onEvent(listener: (event: SessionEvent) => void): () => void;
  send(message: QueuedMessage, immediate?: true): Promise<void>;
  setModel(model: ModelConfiguration): Promise<void>;
  answerQuestion(answer: SessionQuestionAnswer): Promise<boolean>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  rename(name: string, automatic?: true): Promise<boolean>;
  rewind(timestamp: string): Promise<void>;
}

/** Native IDs are opaque. Only Sessions assigns IDs used by the rest of Toy Box. */
export interface SessionProvider {
  readonly id: string;
  readonly name: string;
  isInstalled(): boolean;
  listModels(): Promise<ModelInfo[]>;
  listSkills(
    directory: string | undefined,
    skillDirectories: readonly string[],
  ): Promise<SessionSkill[]>;
  listSessions(): Promise<SessionMetadata[]>;
  /** Read durable history without resuming or acquiring the native session. */
  readHistory(identity: SessionIdentity): Promise<SessionEvent[]>;
  create(sessionId: string, configuration: SessionConfiguration): Promise<SessionConnection>;
  resume(
    identity: SessionIdentity,
    configuration: SessionConfiguration,
  ): Promise<SessionConnection>;
  readDirectory(nativeId: string): Promise<string | undefined>;
  /** The provider owns persistence precision and any trailing-flush policy. */
  isHistoryCurrent(nativeId: string, capturedAt: number): Promise<boolean>;
  delete(nativeId: string): Promise<void>;
  stop(): Promise<void>;
}
