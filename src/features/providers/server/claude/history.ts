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
export async function readClaudeHistory(
  nativeId: string,
  importTranscripts: (
    nativeId: string,
    store: SessionStore,
  ) => Promise<unknown> = importSessionToStore,
): Promise<SDKMessage[]> {
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
  await importTranscripts(nativeId, source);
  const options = { sessionStore: source };
  const root = await readAcrossCompactions(transcripts.get("") ?? [], (main) =>
    getSessionMessages(nativeId, {
      sessionStore: { ...source, load: async (key) => (key.subpath ? source.load(key) : main) },
    }),
  );
  const children = await Promise.all(
    (await listSubagents(nativeId, options)).map((id) =>
      getSubagentMessages(nativeId, id, options),
    ),
  );
  const restore = (messages: SessionMessage[]) =>
    messages.flatMap((message) => {
      const record = records.get(message.uuid);
      // The live stream marks a compaction's summary synthetic; history shows it as a prompt.
      if (record?.isCompactSummary) return [];
      return [
        {
          ...message,
          tool_use_result: record?.toolUseResult,
          effort: record?.effort,
          error: record?.error,
        } as SDKMessage,
      ];
    });
  return asLiveStream(restore(root), children.map(restore));
}

/** The SDK replays a transcript only from its latest compaction, so each earlier part replays from
 * the transcript up to the compaction that closed it. A partial compaction relinks the messages it
 * keeps after its summary, so each message replays once, where it first appeared. */
async function readAcrossCompactions(
  transcript: SessionStoreEntry[],
  read: (transcript: SessionStoreEntry[]) => Promise<SessionMessage[]>,
): Promise<SessionMessage[]> {
  const parts = await Promise.all([
    ...transcript.flatMap((entry, index) =>
      entry.type === "system" && entry.subtype === "compact_boundary"
        ? [read(transcript.slice(0, index))]
        : [],
    ),
    read(transcript),
  ]);
  return [...new Map(parts.flat().map((message) => [message.uuid, message])).values()];
}

// The CLI records Toy Box's model switches as this command, in native history only.
const MODEL_SWITCH = /^<command-name>\/model<\/command-name>/;

/** Replays native history, the main transcript and each subagent's, as the live stream sent it.
 * History keeps no turn results: as in the CLI, a turn whose last assistant message is an API
 * error failed with it, so that result is restored. History alone records each model switch as a
 * `/model` command, and opens each fork with the context it inherited. */
export function asLiveStream(root: SDKMessage[], subagents: SDKMessage[][] = []): SDKMessage[] {
  const main = root.flatMap((message, index) => {
    if (
      message.type === "user" &&
      typeof message.message.content === "string" &&
      MODEL_SWITCH.test(message.message.content)
    )
      return [];
    if (message.type === "assistant" && message.error && root[index + 1]?.type !== "assistant")
      return [
        message,
        {
          type: "result",
          subtype: "success",
          is_error: true,
          result: message.message.content
            .flatMap((block) => (block.type === "text" ? [block.text] : []))
            .join("\n"),
        } as SDKMessage,
      ];
    return [message];
  });
  return [...main, ...subagents.flatMap(withoutForkContext)];
}

/** A fork's transcript opens with the parent message that forked it, which carries the fork's own
 * Agent call, followed by the fork's directive. Other subagent transcripts open with their prompt. */
function withoutForkContext(messages: SDKMessage[]): SDKMessage[] {
  const [first] = messages;
  const forked =
    first?.type === "assistant" &&
    first.message.content.some(
      (block) => block.type === "tool_use" && block.id === first.parent_tool_use_id,
    );
  if (!forked) return messages;
  const directive = messages.findIndex((message) => message.type === "user");
  return directive < 0 ? [] : messages.slice(directive + 1);
}

// Workaround (Claude Agent SDK 0.3.328; listed in providers/AGENTS.md): session info reads `cwd`
// only from a transcript's first 64 KB, so a large first message, such as a pasted image, hides
// it. Read the first entry that records one instead; remove once `getSessionInfo()` finds it.
export async function readTranscriptDirectory(nativeId: string): Promise<string | undefined> {
  let directory: string | undefined;
  const found = new Error("Found the transcript directory.");
  try {
    await importSessionToStore(
      nativeId,
      {
        async append(_key, entries) {
          const cwd = entries.find((entry) => typeof entry.cwd === "string")?.cwd;
          if (typeof cwd !== "string") return;
          directory = cwd;
          // Stop reading the transcript once its directory is known.
          throw found;
        },
        load: async () => null,
      },
      { includeSubagents: false, batchSize: 8 },
    );
  } catch (error) {
    if (error !== found) throw error;
  }
  return directory;
}
