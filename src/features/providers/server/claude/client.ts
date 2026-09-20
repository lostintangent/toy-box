import {
  query,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { sharedSet } from "@/shared/server/processState";

const queries = sharedSet<Query>("claude-queries");

/** The SDK owns stdio and subprocess teardown; use the owner's installed CLI. */
export function startClaudeQuery(
  options: Options,
  prompt: AsyncIterable<SDKUserMessage> = new ReadableStream<SDKUserMessage>(),
): Query {
  const executable = Bun.which("claude");
  if (!executable)
    throw new Error("Install Claude Code and run `claude` to sign in, then refresh Toy Box.");
  const native = query({ prompt, options: { pathToClaudeCodeExecutable: executable, ...options } });
  queries.add(native);
  return native;
}

export async function closeClaudeQuery(native: Query): Promise<void> {
  queries.delete(native);
  await native.return();
}

export async function stopClaude(): Promise<void> {
  await Promise.all([...queries].map(closeClaudeQuery));
}
