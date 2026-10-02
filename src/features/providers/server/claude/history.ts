import {
  getSessionMessages,
  getSubagentMessages,
  importSessionToStore,
  listSubagents,
  type SDKMessage,
  type SessionMessage,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";

/** One read of native history; the SDK owns file discovery and active-branch reconstruction.
 * getSessionMessages omits structured tool results, effort, and API errors. Its export API
 * supplies those records to this request-local buffer; nothing is mirrored, cached, or
 * persisted by this provider. */
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
  const restore = (messages: SessionMessage[]) =>
    messages
      .filter(
        (message) => !("isCompletedLocalCommand" in message && message.isCompletedLocalCommand),
      )
      .map((message) => {
        const record = records.get(message.uuid);
        return {
          ...message,
          tool_use_result: record?.toolUseResult,
          effort: record?.effort,
          error: record?.error,
        } as SDKMessage;
      });
  return [...restoreFailedTurns(restore(root)), ...restore(children.flat())];
}

/** Native history keeps no turn results. As in the CLI, a turn whose last assistant message is an
 * API error failed with that message, so its result is restored where the live stream sent one. */
export function restoreFailedTurns(messages: SDKMessage[]): SDKMessage[] {
  return messages.flatMap((message, index) =>
    message.type === "assistant" && message.error && messages[index + 1]?.type !== "assistant"
      ? [
          message,
          {
            type: "result",
            subtype: "success",
            is_error: true,
            result: message.message.content
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join("\n"),
          } as SDKMessage,
        ]
      : [message],
  );
}
