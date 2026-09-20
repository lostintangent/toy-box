import {
  getSessionMessages,
  getSubagentMessages,
  importSessionToStore,
  listSubagents,
  type SDKMessage,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";

/** One read of native history; the SDK owns file discovery and active-branch reconstruction.
 * getSessionMessages omits structured tool results. Its export API supplies those records
 * to this request-local buffer; nothing is mirrored, cached, or persisted by this provider. */
export async function readClaudeHistory(nativeId: string): Promise<SDKMessage[]> {
  const transcripts = new Map<string, SessionStoreEntry[]>();
  const records = new Map<string, SessionStoreEntry>();
  const source: SessionStore = {
    async append({ subpath = "" }, entries) {
      const transcript = transcripts.get(subpath) ?? [];
      transcript.push(...entries);
      transcripts.set(subpath, transcript);
      for (const entry of entries) if (entry.uuid) records.set(entry.uuid, entry);
    },
    async load({ subpath = "" }) {
      return transcripts.get(subpath) ?? null;
    },
    async listSubkeys() {
      return [...transcripts.keys()].filter(Boolean);
    },
  };
  await importSessionToStore(nativeId, source);
  const options = { sessionStore: source };
  const root = await getSessionMessages(nativeId, options);
  const children = await Promise.all(
    (await listSubagents(nativeId, options)).map((id) =>
      getSubagentMessages(nativeId, id, options),
    ),
  );
  return [...root, ...children.flat()]
    .filter((message) => !("isCompletedLocalCommand" in message && message.isCompletedLocalCommand))
    .map(
      (message) =>
        ({
          ...message,
          tool_use_result: records.get(message.uuid)?.toolUseResult,
          effort: records.get(message.uuid)?.effort,
        }) as SDKMessage,
    );
}
