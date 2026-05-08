import type { CopilotSession } from "@github/copilot-sdk";
import { createSession, type CreateSessionOptions } from "@/functions/state/sessionCache";
import { updateSessionSummary } from "./broadcast";
import { SessionStream } from "./stream";

export type ManagedSessionHandle = {
  sessionId: string;
  session: CopilotSession;
  stream: SessionStream;
};

export type CreateManagedSessionOptions = CreateSessionOptions & {
  sessionId: string;
  summary?: string;
};

export type CreateAndStartSessionOptions = CreateManagedSessionOptions & {
  prompt: string;
};

export async function createManagedSession(
  options: CreateManagedSessionOptions,
): Promise<ManagedSessionHandle> {
  const session = await createSession(options.sessionId, {
    model: options.model,
    directory: options.directory,
    useWorktree: options.useWorktree,
    initialContext: options.initialContext,
  });

  if (options.summary) {
    updateSessionSummary(options.sessionId, options.summary, {
      replace: true,
    });
  }

  return {
    sessionId: options.sessionId,
    session,
    stream: SessionStream.getOrCreate(options.sessionId, session, {
      model: options.model,
    }),
  };
}

export async function startManagedSessionTurn(
  sessionHandle: ManagedSessionHandle,
  prompt: string,
): Promise<void> {
  sessionHandle.stream.startTurn(prompt);

  try {
    await sessionHandle.session.send({ prompt });
  } catch (error) {
    sessionHandle.stream.markSendFailure();
    sessionHandle.stream.detach();
    throw error;
  }
}

export async function createAndStartSession(
  options: CreateAndStartSessionOptions,
): Promise<ManagedSessionHandle> {
  const sessionHandle = await createManagedSession(options);
  await startManagedSessionTurn(sessionHandle, options.prompt);
  return sessionHandle;
}
