import type { Thread, ThreadTurnsListResponse, Turn } from "./protocol";
import type { CodexTransport } from "./protocol/transport";
import { hydrateThreadInputs } from "./messages";

/** Read stored turns without attaching to the thread's execution. */
export async function readThreadHistory(rpc: CodexTransport, threadId: string): Promise<Thread> {
  const { thread } = await rpc.request("thread/read", { threadId, includeTurns: false });
  if (thread.historyMode !== "paginated")
    return hydrateThreadInputs(
      (await rpc.request("thread/read", { threadId, includeTurns: true })).thread,
    );
  const turns: Turn[] = [];
  let cursor: string | null = null;
  do {
    const page: ThreadTurnsListResponse = await rpc.request("thread/turns/list", {
      threadId,
      cursor,
      limit: 100,
      sortDirection: "asc",
      itemsView: "full",
    });
    turns.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return hydrateThreadInputs({ ...thread, turns });
}
