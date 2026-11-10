// Providers adapt native histories and live activity to Sessions' domain model.
// Sessions supplies host policy and resources, and owns queues and completion.

import type { ModelConfiguration, ModelInfo, ProviderSubscription } from "@providers/model";
import type { SessionEvent, SessionMessage, Session, SessionSkill } from "@sessions/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import type { Tool } from "@sessions/server/tools/definition";

/** The operation was not submitted; reacquiring the connection is safe. */
export class SessionConnectionUnavailableError extends Error {}

/** The provider has no history for this session. */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}.`);
  }
}

export type SessionConfiguration = {
  model?: ModelConfiguration;
  directory: string;
  allowUserQuestions: boolean;
  /** Bound to the session: each handler validates its arguments and returns the model's text. */
  tools: (Omit<Tool, "handler"> & { handler: (args: unknown) => Promise<string> })[];
  instructions: string;
  skillDirectories: string[];
  disableMemory?: boolean;
};

/** A native history's metadata, addressed by the provider's own ID. */
export type NativeSession = Pick<Session, "title" | "createdAt" | "updatedAt" | "context"> & {
  nativeId: string;
};

/** One attached native session, independent of browser observation. */
export interface SessionConnection {
  readonly nativeId: string;
  /** The runtime consumes end to drain queued work before publishing completion. */
  onEvent(listener: (event: SessionEvent) => void): () => void;
  send(message: SessionMessage): Promise<void>;
  setModel(model: ModelConfiguration): Promise<void>;
  answerQuestion(answer: SessionQuestionAnswer): Promise<boolean>;
  /**
   * Resolves once the agent has stopped: its active turn, input it hasn't reached, and its
   * subagents. Processes it launched are left to the native runtime.
   */
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  rename(name: string, automatic?: true): Promise<boolean>;
  rewind(timestamp: string): Promise<void>;
}

/** Providers reuse the supplied session ID when supported; native overrides remain opaque. */
export interface SessionProvider {
  readonly id: string;
  readonly name: string;
  /** Whether the native runtime has credentials to start new work. */
  isSignedIn(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  /** Read the signed-in account's subscription; an account using an API key has none. */
  readSubscription(): Promise<ProviderSubscription | undefined>;
  listSkills(
    directory: string | undefined,
    skillDirectories: readonly string[],
  ): Promise<SessionSkill[]>;
  /** A limit asks for at least the newest `limit` sessions. */
  listSessions(limit?: number): Promise<NativeSession[]>;
  /** A gone history reads undefined or rejects, as its SDK reports it. */
  readSession(nativeId: string): Promise<NativeSession | undefined>;
  /** Read durable history without resuming or acquiring the native session. */
  readHistory(nativeId: string): Promise<SessionEvent[]>;
  create(
    sessionId: string,
    configuration: SessionConfiguration & { name?: string },
  ): Promise<SessionConnection>;
  resume(nativeId: string, configuration: SessionConfiguration): Promise<SessionConnection>;
  /** The provider owns persistence precision and any trailing-flush policy. */
  isHistoryCurrent(nativeId: string, capturedAt: number): Promise<boolean>;
  /** Resolves when the history is already gone. */
  delete(nativeId: string): Promise<void>;
  stop(): Promise<void>;
}
