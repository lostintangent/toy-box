// Generated from codex-cli 0.153.2 (experimental app-server schema).
// OpenAI Codex, Apache-2.0: https://github.com/openai/codex
// Regenerate using ./generate.ts. Do not edit wire types by hand.

export type InitializeParams = {
  clientInfo: ClientInfo;
  capabilities: InitializeCapabilities | null;
};

export type ClientInfo = { name: string; title: string | null; version: string };

/**
 * Client-declared capabilities negotiated during initialize.
 */
export type InitializeCapabilities = {
  /**
   * Opt into receiving experimental API methods and fields.
   */
  experimentalApi: boolean;
  /**
   * Opt into `attestation/generate` requests for upstream `x-oai-attestation`.
   */
  requestAttestation: boolean;
  /**
   * Legacy opt-in for the `openai/form` MCP extension.
   *
   * New clients should declare `openai/form` in [`Self::extensions`].
   */
  mcpServerOpenaiFormElicitation?: boolean;
  /**
   * Exact notification method names that should be suppressed for this
   * connection (for example `thread/started`).
   */
  optOutNotificationMethods?: Array<string> | null;
  /**
   * MCP extension settings declared by the app-server client.
   */
  extensions?: { [key in string]?: JsonValue } | null;
};

export type JsonValue =
  | number
  | string
  | boolean
  | Array<JsonValue>
  | { [key in string]?: JsonValue }
  | null;

export type InitializeResponse = {
  userAgent: string;
  /**
   * Absolute path to the server's $CODEX_HOME directory.
   */
  codexHome: AbsolutePathBuf;
  /**
   * Platform family for the running app-server target, for example
   * `"unix"` or `"windows"`.
   */
  platformFamily: string;
  /**
   * Operating system for the running app-server target, for example
   * `"macos"`, `"linux"`, or `"windows"`.
   */
  platformOs: string;
};

/**
 * A path that is guaranteed to be absolute and normalized (though it is not
 * guaranteed to be canonicalized or exist on the filesystem).
 *
 * IMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set
 * using [AbsolutePathBufGuard::new]. If no base path is set, the
 * deserialization will fail unless the path being deserialized is already
 * absolute.
 */
export type AbsolutePathBuf = string;

export type ModelListParams = {
  /**
   * Opaque pagination cursor returned by a previous call.
   */
  cursor?: string | null;
  /**
   * Optional page size; defaults to a reasonable server-side value.
   */
  limit?: number | null;
  /**
   * When true, include models that are hidden from the default picker list.
   */
  includeHidden?: boolean | null;
};

export type ModelListResponse = {
  data: Array<Model>;
  /**
   * Opaque cursor to pass to the next call to continue after the last item.
   * If None, there are no more items to return.
   */
  nextCursor: string | null;
};

export type Model = {
  id: string;
  model: string;
  upgrade: string | null;
  upgradeInfo: ModelUpgradeInfo | null;
  availabilityNux: ModelAvailabilityNux | null;
  displayName: string;
  description: string;
  modelSpecialty: string | null;
  hidden: boolean;
  supportedReasoningEfforts: Array<ReasoningEffortOption>;
  defaultReasoningEffort: ReasoningEffort;
  inputModalities: Array<InputModality>;
  supportsPersonality: boolean;
  /**
   * Multi-agent runtime declared by this model, when available.
   */
  multiAgentVersion: MultiAgentVersion | null;
  /**
   * Deprecated: use `serviceTiers` instead.
   */
  additionalSpeedTiers: Array<string>;
  serviceTiers: Array<ModelServiceTier>;
  /**
   * Catalog default service tier id for this model, when one is configured.
   */
  defaultServiceTier: string | null;
  isDefault: boolean;
};

/**
 * Canonical user-input modality tags advertised by a model.
 */
export type InputModality = "text" | "image" | "audio";

/**
 * See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#get-started-with-reasoning
 */
export type ReasoningEffort = string;

export type ModelAvailabilityNux = { message: string };

export type ModelServiceTier = { id: string; name: string; description: string };

export type ModelUpgradeInfo = {
  model: string;
  upgradeCopy: string | null;
  modelLink: string | null;
  migrationMarkdown: string | null;
  /**
   * Informational Unix timestamp for this upgrade's scheduled retirement, if known.
   */
  retirementAt: number | null;
};

/**
 * Multi-agent runtime supported by a model.
 */
export type MultiAgentVersion = "disabled" | "v1" | "v2";

export type ReasoningEffortOption = { reasoningEffort: ReasoningEffort; description: string };

export type GetAccountParams = {
  /**
   * When `true`, requests a proactive token refresh before returning.
   *
   * In managed auth mode this triggers the normal refresh-token flow. In
   * external auth mode this flag is ignored. Clients should refresh tokens
   * themselves and call `account/login/start` with `chatgptAuthTokens`.
   */
  refreshToken?: boolean;
};

export type GetAccountResponse = { account: Account | null; requiresOpenaiAuth: boolean };

export type Account =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string | null; planType: PlanType }
  | { type: "amazonBedrock"; usesCodexManagedCredentials: boolean };

export type PlanType =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "prolite"
  | "team"
  | "self_serve_business_prolite"
  | "self_serve_business_usage_based"
  | "business"
  | "ent26"
  | "enterprise_cbp_automation"
  | "enterprise_cbp_usage_based"
  | "enterprise"
  | "edu"
  | "edu_plus"
  | "edu_pro"
  | "unknown";

export type SkillsListParams = {
  /**
   * When empty, defaults to the current session working directory.
   */
  cwds?: Array<string>;
  /**
   * When true, bypass the skills cache and re-scan skills from disk.
   */
  forceReload?: boolean;
};

export type SkillsListResponse = { data: Array<SkillsListEntry> };

export type SkillsListEntry = {
  cwd: string;
  skills: Array<SkillMetadata>;
  errors: Array<SkillErrorInfo>;
};

export type SkillErrorInfo = { path: string; message: string };

export type SkillMetadata = {
  name: string;
  description: string;
  /**
   * Legacy short_description from SKILL.md. Prefer SKILL.json interface.short_description.
   */
  shortDescription?: string;
  interface?: SkillInterface;
  dependencies?: SkillDependencies;
  path: AbsolutePathBuf;
  scope: SkillScope;
  enabled: boolean;
  /**
   * Owning plugin ID, matching `PluginSummary.id`, when known.
   */
  pluginId: string | null;
};

export type SkillDependencies = { tools: Array<SkillToolDependency> };

export type SkillToolDependency = {
  type: string;
  value: string;
  description?: string;
  transport?: string;
  command?: string;
  url?: string;
};

export type SkillInterface = {
  displayName?: string;
  shortDescription?: string;
  iconSmall?: AbsolutePathBuf;
  iconLarge?: AbsolutePathBuf;
  /**
   * Remote small icon URL from the plugin catalog.
   */
  iconSmallUrl: string | null;
  /**
   * Remote large icon URL from the plugin catalog.
   */
  iconLargeUrl: string | null;
  brandColor?: string;
  defaultPrompt?: string;
};

export type SkillScope = "user" | "repo" | "system" | "admin";

export type ThreadListParams = {
  /**
   * Opaque pagination cursor returned by a previous call.
   */
  cursor?: string | null;
  /**
   * Optional page size; defaults to a reasonable server-side value.
   */
  limit?: number | null;
  /**
   * Optional sort key; defaults to created_at.
   */
  sortKey?: ThreadSortKey | null;
  /**
   * Optional sort direction; defaults to descending (newest first).
   */
  sortDirection?: SortDirection | null;
  /**
   * Optional provider filter; when set, only sessions recorded under these
   * providers are returned. When present but empty, includes all providers.
   */
  modelProviders?: Array<string> | null;
  /**
   * Optional source filter; when set, only sessions from these source kinds
   * are returned. When omitted or empty, defaults to interactive sources.
   */
  sourceKinds?: Array<ThreadSourceKind> | null;
  /**
   * Optional archived filter; when set to true, only archived threads are returned.
   * If false or null, only non-archived threads are returned.
   */
  archived?: boolean | null;
  /**
   * Omit to include every section, set to `null` for unsectioned threads,
   * or provide a section ID to return only threads in that section.
   */
  sectionId?: string | null;
  /**
   * Omit to include every project, set to null for unassigned threads,
   * or provide a project ID to return only threads in that project.
   */
  projectId?: string | null;
  /**
   * Optional cwd filter or filters; when set, only threads whose session cwd
   * exactly matches one of these paths are returned.
   */
  cwd?: string | Array<string> | null;
  /**
   * If true, return from the state DB without scanning JSONL rollouts to
   * repair thread metadata. Omitted or false preserves scan-and-repair
   * behavior.
   */
  useStateDbOnly?: boolean;
  /**
   * Optional substring filter for the extracted thread title.
   */
  searchTerm?: string | null;
  /**
   * Optional direct parent thread filter. Mutually exclusive with `ancestorThreadId`.
   */
  parentThreadId?: string | null;
  /**
   * Optional ancestor thread filter. Returns spawned descendants at any depth, excluding the
   * ancestor itself. Mutually exclusive with `parentThreadId`.
   */
  ancestorThreadId?: string | null;
};

export type SortDirection = "asc" | "desc";

export type ThreadSortKey = "created_at" | "updated_at" | "recency_at" | "section_position";

export type ThreadSourceKind =
  | "cli"
  | "vscode"
  | "exec"
  | "appServer"
  | "subAgent"
  | "subAgentReview"
  | "subAgentCompact"
  | "subAgentThreadSpawn"
  | "subAgentOther"
  | "unknown";

export type ThreadListResponse = {
  data: Array<Thread>;
  /**
   * Opaque cursor to pass to the next call to continue after the last item.
   * if None, there are no more items to return.
   */
  nextCursor: string | null;
  /**
   * Opaque cursor to pass as `cursor` when reversing `sortDirection`.
   * This is only populated when the page contains at least one thread.
   * Use it with the opposite `sortDirection`; for timestamp sorts it anchors
   * at the start of the page timestamp so same-second updates are not skipped.
   */
  backwardsCursor: string | null;
};

export type Thread = {
  /**
   * Identifier for this thread. Codex-generated thread IDs are UUIDv7.
   */
  id: string;
  /**
   * Optional implementation-specific thread data.
   */
  extra: ThreadExtra | null;
  /**
   * Session id shared by threads that belong to the same session tree.
   */
  sessionId: string;
  /**
   * Source thread id when this thread was created by forking another thread.
   */
  forkedFromId: string | null;
  /**
   * The ID of the parent thread. This will only be set if this thread is a subagent.
   */
  parentThreadId: string | null;
  /**
   * Usually the first user message in the thread, if available.
   */
  preview: string;
  /**
   * Whether the thread is ephemeral and should not be materialized on disk.
   */
  ephemeral: boolean;
  /**
   * The independently persisted section selected for this thread, if any.
   */
  section: ThreadSection | null;
  /**
   * Unix timestamp in seconds when the thread entered its current section.
   */
  sectionEnteredAt: number | null;
  /**
   * Canonical project assignment owned by app-server, if any.
   */
  projectId: string | null;
  /**
   * Persisted thread history contract selected when this thread was created.
   */
  historyMode: ThreadHistoryMode;
  /**
   * Model provider used for this thread (for example, 'openai').
   */
  modelProvider: string;
  /**
   * Current configured model when loaded, otherwise the latest persisted model.
   * Null when unavailable. This is not per-turn execution telemetry.
   */
  model: string | null;
  /**
   * Current configured reasoning effort when loaded, otherwise the latest persisted effort.
   * Null when unset or unavailable. This is not per-turn execution telemetry.
   */
  reasoningEffort: ReasoningEffort | null;
  /**
   * Unix timestamp (in seconds) when the thread was created.
   */
  createdAt: number;
  /**
   * Unix timestamp (in seconds) when the thread was last updated.
   */
  updatedAt: number;
  /**
   * Unix timestamp (in seconds) used for thread recency ordering.
   */
  recencyAt: number | null;
  /**
   * Current runtime status for the thread.
   */
  status: ThreadStatus;
  /**
   * [UNSTABLE] Path to the thread on disk.
   */
  path: string | null;
  /**
   * Working directory captured for the thread.
   */
  cwd: AbsolutePathBuf;
  /**
   * Version of the CLI that created the thread.
   */
  cliVersion: string;
  /**
   * Origin of the thread (CLI, VSCode, codex exec, codex app-server, etc.).
   */
  source: SessionSource;
  /**
   * Whether the app server accepts direct turn input for this loaded thread.
   * `None` means the capability is unavailable, such as for an unloaded stored thread.
   */
  canAcceptDirectInput: boolean | null;
  /**
   * Optional analytics source classification for this thread.
   */
  threadSource: ThreadSource | null;
  /**
   * Optional random unique nickname assigned to an AgentControl-spawned sub-agent.
   */
  agentNickname: string | null;
  /**
   * Optional role (agent_role) assigned to an AgentControl-spawned sub-agent.
   */
  agentRole: string | null;
  /**
   * Optional Git metadata captured when the thread was created.
   */
  gitInfo: GitInfo | null;
  /**
   * Optional user-facing thread title.
   */
  name: string | null;
  /**
   * Only populated on `thread/resume`, `thread/rollback`, `thread/fork`, and `thread/read`
   * (when `includeTurns` is true) responses.
   * For all other responses and notifications returning a Thread,
   * the turns field will be an empty list.
   */
  turns: Array<Turn>;
};

export type GitInfo = { sha: string | null; branch: string | null; originUrl: string | null };

export type SessionSource =
  | "cli"
  | "vscode"
  | "exec"
  | "appServer"
  | { custom: string }
  | { subAgent: SubAgentSource }
  | "unknown";

export type SubAgentSource =
  | "review"
  | "compact"
  | {
      thread_spawn: {
        parent_thread_id: ThreadId;
        depth: number;
        agent_path: AgentPath | null;
        agent_nickname: string | null;
        agent_role: string | null;
      };
    }
  | "memory_consolidation"
  | { other: string };

export type AgentPath = string;

/**
 * Identifier for a Codex thread.
 *
 * Codex-generated thread IDs are UUIDv7, and some use cases rely on that.
 */
export type ThreadId = string;

/**
 * Extra app-server data for a thread.
 */
export type ThreadExtra = Record<string, never>;

export type ThreadHistoryMode = "legacy" | "paginated";

/**
 * An independently persisted, user-visible thread section.
 */
export type ThreadSection = {
  /**
   * Opaque UUIDv7 identity that remains stable when the section is renamed.
   */
  id: string;
  /**
   * The current user-visible section name.
   */
  name: string;
  /**
   * Optional appearance synchronized across clients.
   */
  appearance: ThreadSectionAppearance | null;
};

/**
 * Extensible visual presentation for a custom thread section.
 */
export type ThreadSectionAppearance = { icon: string | null; color: string | null };

export type ThreadSource = string;

export type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: Array<ThreadActiveFlag> };

export type ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";

export type Turn = {
  /**
   * Identifier for this turn. Codex-generated turn IDs are UUIDv7.
   */
  id: string;
  /**
   * Thread items currently included in this turn payload.
   */
  items: Array<ThreadItem>;
  /**
   * Describes how much of `items` has been loaded for this turn.
   */
  itemsView: TurnItemsView;
  status: TurnStatus;
  /**
   * Only populated when the Turn's status is failed.
   */
  error: TurnError | null;
  /**
   * Unix timestamp (in seconds) when the turn started.
   */
  startedAt: number | null;
  /**
   * Unix timestamp (in seconds) when the turn completed.
   */
  completedAt: number | null;
  /**
   * Duration between turn start and completion in milliseconds, if known.
   */
  durationMs: number | null;
};

export type ThreadItem =
  | { type: "userMessage"; id: string; clientId: string | null; content: Array<UserInput> }
  | { type: "hookPrompt"; id: string; fragments: Array<HookPromptFragment> }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase: MessagePhase | null;
      memoryCitation: MemoryCitation | null;
      delivery: AgentMessageDelivery | null;
      questions: Array<AsyncUserInputQuestion> | null;
    }
  | {
      type: "functionCallOutput";
      id: string;
      name: string;
      namespace: string | null;
      output: FunctionCallOutputBody;
    }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: Array<string>; content: Array<string> }
  | {
      type: "commandExecution";
      id: string;
      /**
       * Trusted first-party plugin id when this command resolves to one plugin script.
       */
      pluginId: string | null;
      /**
       * Safe plugin-relative path when this command resolves to one plugin script.
       */
      scriptPath: string | null;
      /**
       * The command to be executed.
       */
      command: string;
      /**
       * The command's working directory.
       */
      cwd: LegacyAppPathString;
      /**
       * Identifier for the underlying PTY process (when available).
       */
      processId: string | null;
      source: CommandExecutionSource;
      status: CommandExecutionStatus;
      /**
       * A best-effort parsing of the command to understand the action(s) it will perform.
       * This returns a list of CommandAction objects because a single shell command may
       * be composed of many commands piped together.
       */
      commandActions: Array<CommandAction>;
      /**
       * The command's output, aggregated from stdout and stderr.
       */
      aggregatedOutput: string | null;
      /**
       * The command's exit code.
       */
      exitCode: number | null;
      /**
       * The duration of the command execution in milliseconds.
       */
      durationMs: number | null;
    }
  | { type: "fileChange"; id: string; changes: Array<FileUpdateChange>; status: PatchApplyStatus }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      status: McpToolCallStatus;
      arguments: JsonValue;
      appContext: McpToolCallAppContext | null;
      /**
       * Deprecated: use `appContext.resourceUri` instead.
       */
      mcpAppResourceUri?: string;
      pluginId: string | null;
      readOnlyHint: boolean | null;
      result: McpToolCallResult | null;
      error: McpToolCallError | null;
      /**
       * The duration of the MCP tool call in milliseconds.
       */
      durationMs: number | null;
    }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace: string | null;
      tool: string;
      arguments: JsonValue;
      status: DynamicToolCallStatus;
      contentItems: Array<DynamicToolCallOutputContentItem> | null;
      success: boolean | null;
      /**
       * The duration of the dynamic tool call in milliseconds.
       */
      durationMs: number | null;
    }
  | {
      type: "collabAgentToolCall";
      /**
       * Unique identifier for this collab tool call.
       */
      id: string;
      /**
       * Name of the collab tool that was invoked.
       */
      tool: CollabAgentTool;
      /**
       * Current status of the collab tool call.
       */
      status: CollabAgentToolCallStatus;
      /**
       * Thread ID of the agent issuing the collab request.
       */
      senderThreadId: string;
      /**
       * Thread ID of the receiving agent, when applicable. In case of spawn operation,
       * this corresponds to the newly spawned agent.
       */
      receiverThreadIds: Array<string>;
      /**
       * Prompt text sent as part of the collab tool call, when available.
       */
      prompt: string | null;
      /**
       * Model requested for the spawned agent, when applicable.
       */
      model: string | null;
      /**
       * Reasoning effort requested for the spawned agent, when applicable.
       */
      reasoningEffort: ReasoningEffort | null;
      /**
       * Last known status of the target agents, when available.
       */
      agentsStates: { [key in string]?: CollabAgentState };
    }
  | {
      type: "subAgentActivity";
      id: string;
      kind: SubAgentActivityKind;
      agentThreadId: string;
      agentPath: string;
    }
  | ({ type: "webSearch" } & WebSearchItem)
  | { type: "imageView"; id: string; path: LegacyAppPathString }
  | ({ type: "sleep" } & SleepItem)
  | ({ type: "imageGeneration" } & ImageGenerationItem)
  | { type: "enteredReviewMode"; id: string; review: string }
  | { type: "exitedReviewMode"; id: string; review: string }
  | { type: "contextCompaction"; id: string };

export type FunctionCallOutputBody = string | Array<FunctionCallOutputContentItem>;

/**
 * Responses API compatible content items that can be returned by a tool call.
 * This is a subset of ContentItem with the types we support as function call outputs.
 */
export type FunctionCallOutputContentItem =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: ImageDetail }
  | { type: "input_audio"; audio_url: string }
  | { type: "encrypted_content"; encrypted_content: string };

export type ImageDetail = "auto" | "low" | "high" | "original";

export type ImageGenerationItem = {
  id: string;
  status: string;
  revisedPrompt: string | null;
  result: string;
  transparentBackground?: boolean;
  failure: ImageGenerationFailure | null;
  savedPath?: AbsolutePathBuf;
};

export type ImageGenerationFailure = {
  type: "usageLimitExceeded";
  limitId: string;
  resetsAt: number | null;
};

/**
 * A UTF-8 path for preserving raw path compatibility at the app-server API
 * boundary while Codex migrates to [`PathUri`].
 *
 * Supports storing arbitrary strings read from the API and converting to and
 * from [`PathUri`] using an explicitly selected native path convention.
 *
 * When converting from [`PathUri`], "native" refers to the supplied
 * [`PathConvention`], which may be foreign to the operating system running
 * this process. The inner string is private so path-producing code must use a
 * path conversion method instead of bypassing the intended conversion
 * boundary. Non-UTF-8 paths are converted to UTF-8 lossily because this API
 * value is serialized as a JSON string.
 *
 * Deserialization and [`Self::from_string`] accept any UTF-8 string without
 * interpreting or validating it. Use [`Self::from_string`] when a caller
 * already owns legacy app-server path text and needs to preserve its wire
 * spelling; use [`Self::from_path`], [`Self::from_abs_path`], or
 * [`Self::from_path_uri`] when converting an actual path value. Relative
 * path text remains valid until an operation such as [`Self::to_path_uri`]
 * requires an absolute path.
 */
export type LegacyAppPathString = string;

/**
 * Classifies an assistant message as interim commentary or final answer text.
 *
 * Providers do not emit this consistently, so callers must treat `None` as
 * "phase unknown" and keep compatibility behavior for legacy models.
 */
export type MessagePhase = "commentary" | "final_answer";

/**
 * Display item emitted by the interruptible `clock.sleep` tool.
 */
export type SleepItem = { id: string; durationMs: number };

export type WebSearchItem = {
  id: string;
  query: string;
  action: WebSearchAction | null;
  /**
   * Structured search results returned out-of-band by standalone web search.
   *
   * These stay as opaque JSON at the extension/app-server boundary so new
   * result fields and result types can pass through without a Codex release.
   */
  results: Array<JsonValue> | null;
};

export type WebSearchAction =
  | { type: "search"; query: string | null; queries: Array<string> | null }
  | { type: "openPage"; url: string | null }
  | { type: "findInPage"; url: string | null; pattern: string | null }
  | { type: "other" };

export type AgentMessageDelivery = "async";

export type AsyncUserInputQuestion = { title: string; options: Array<string> | null };

export type CollabAgentState = { status: CollabAgentStatus; message: string | null };

export type CollabAgentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";

export type CollabAgentTool =
  | "spawnAgent"
  | "sendInput"
  | "resumeAgent"
  | "wait"
  | "closeAgent"
  | "sendMessage"
  | "followupTask"
  | "interruptAgent"
  | "listAgents";

export type CollabAgentToolCallStatus = "inProgress" | "completed" | "failed" | "interrupted";

export type CommandAction =
  | { type: "read"; command: string; name: string; path: LegacyAppPathString }
  | { type: "listFiles"; command: string; path: string | null }
  | { type: "search"; command: string; query: string | null; path: string | null }
  | { type: "unknown"; command: string };

export type CommandExecutionSource =
  | "agent"
  | "userShell"
  | "unifiedExecStartup"
  | "unifiedExecInteraction";

export type CommandExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

export type DynamicToolCallOutputContentItem =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string }
  | { type: "inputAudio"; audioUrl: string };

export type DynamicToolCallStatus = "inProgress" | "completed" | "failed";

export type FileUpdateChange = { path: string; kind: PatchChangeKind; diff: string };

export type PatchChangeKind =
  | { type: "add" }
  | { type: "delete" }
  | { type: "update"; move_path: string | null };

export type HookPromptFragment = { text: string; hookRunId: string };

export type McpToolCallAppContext = {
  connectorId: string;
  linkId: string | null;
  resourceUri: string | null;
  appName: string | null;
  actionName: string | null;
};

export type McpToolCallError = { message: string };

export type McpToolCallResult = {
  content: Array<JsonValue>;
  structuredContent: JsonValue | null;
  _meta: JsonValue | null;
};

export type McpToolCallStatus = "inProgress" | "completed" | "failed";

export type MemoryCitation = { entries: Array<MemoryCitationEntry>; threadIds: Array<string> };

export type MemoryCitationEntry = {
  path: string;
  lineStart: number;
  lineEnd: number;
  note: string;
};

export type PatchApplyStatus = "inProgress" | "completed" | "failed" | "declined";

export type SubAgentActivityKind = "started" | "interacted" | "interrupted" | "completed";

export type UserInput =
  | {
      type: "text";
      text: string;
      /**
       * UI-defined spans within `text` used to render or persist special elements.
       */
      text_elements: Array<TextElement>;
    }
  | { type: "image"; detail?: ImageDetail; url: string }
  | { type: "localImage"; detail?: ImageDetail; path: string }
  | { type: "audio"; url: string }
  | { type: "localAudio"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type TextElement = {
  /**
   * Byte range in the parent `text` buffer that this element occupies.
   */
  byteRange: ByteRange;
  /**
   * Optional human-readable placeholder for the element, displayed in the UI.
   */
  placeholder: string | null;
};

export type ByteRange = { start: number; end: number };

export type TurnError = {
  message: string;
  codexErrorInfo: CodexErrorInfo | null;
  additionalDetails: string | null;
  /**
   * Optional public explanation and continuation instruction for a misalignment block.
   */
  misalignment: MisalignmentErrorDetails | null;
};

/**
 * This translation layer make sure that we expose codex error code in camel case.
 *
 * When an upstream HTTP status is available (for example, from the Responses API or a provider),
 * it is forwarded in `httpStatusCode` on the relevant `codexErrorInfo` variant.
 */
export type CodexErrorInfo =
  | "contextWindowExceeded"
  | "sessionBudgetExceeded"
  | "usageLimitExceeded"
  | "rateLimitExceeded"
  | "serverOverloaded"
  | "cyberPolicy"
  | "misalignmentPolicyViolation"
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | "internalServerError"
  | "unauthorized"
  | "badRequest"
  | "threadRollbackFailed"
  | "sandboxError"
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { activeTurnNotSteerable: { turnKind: NonSteerableTurnKind } }
  | "other";

export type NonSteerableTurnKind = "review" | "compact";

export type MisalignmentErrorDetails = {
  /**
   * Open-ended classification; clients must accept categories added by Responses.
   */
  errorType: string | null;
  /**
   * A substantive localized explanation is required before offering continuation.
   */
  detailedExplanation: string | null;
  /**
   * Instruction to submit as the next turn's user input if continuation is confirmed.
   */
  steer: MisalignmentSteer | null;
};

export type MisalignmentSteer = { message: string };

export type TurnItemsView = "notLoaded" | "summary" | "full";

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export type ThreadStartParams = {
  model?: string | null;
  modelProvider?: string | null;
  /**
   * Allow a provider with an authoritative static model catalog to replace an unavailable
   * requested model with its default.
   */
  allowProviderModelFallback?: boolean;
  serviceTier?: string | null;
  cwd?: string | null;
  /**
   * Replace the thread's runtime workspace roots. Paths must be absolute.
   */
  runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null;
  approvalPolicy?: AskForApproval | null;
  /**
   * Override where approval requests are routed for review on this thread
   * and subsequent turns.
   */
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode | null;
  /**
   * Named profile id for this thread. Cannot be combined with `sandbox`.
   */
  permissions?: string | null;
  config?: { [key in string]?: JsonValue } | null;
  serviceName?: string | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: Personality | null;
  /**
   * @deprecated Ignored. Use Ultra reasoning effort for proactive multi-agent behavior.
   */
  multiAgentMode?: MultiAgentMode | null;
  ephemeral?: boolean | null;
  /**
   * Persisted thread history contract to use for this new thread.
   */
  historyMode?: ThreadHistoryMode | null;
  sessionStartSource?: ThreadStartSource | null;
  /**
   * Optional client-supplied analytics source classification for this thread.
   */
  threadSource?: ThreadSource | null;
  /**
   * Optional project identity for this new thread. Durable threads persist
   * the assignment; ephemeral threads expose it only in live responses.
   */
  projectId?: string | null;
  /**
   * Optional sticky environments for this thread.
   *
   * Omitted selects the default environment when environment access is
   * enabled. Empty disables environment access for turns that do not
   * provide a turn override. Non-empty selects the first environment as the
   * current turn environment.
   */
  environments?: Array<TurnEnvironmentParams> | null;
  dynamicTools?: Array<DynamicToolSpec> | null;
  /**
   * Capability roots selected for this thread by the hosting platform.
   */
  selectedCapabilityRoots?: Array<SelectedCapabilityRoot> | null;
  /**
   * Test-only experimental field used to validate experimental gating and
   * schema filtering behavior in a stable way.
   */
  mockExperimentalField?: string | null;
  /**
   * If true, opt into emitting raw Responses API items on the event stream.
   * This is for internal use only (e.g. Codex Cloud).
   */
  experimentalRawEvents?: boolean;
};

/**
 * Controls the effective multi-agent delegation instructions for a turn. `custom` means the
 * configured mode hint defines the policy instead of a built-in policy.
 */
export type MultiAgentMode = { custom: string } | "explicitRequestOnly" | "proactive";

export type Personality = "none" | "friendly" | "pragmatic";

/**
 * Configures who approval requests are routed to for review. Examples
 * include sandbox escapes, blocked network access, MCP approval prompts, and
 * ARC escalations. Defaults to `user`. `auto_review` uses a carefully
 * prompted subagent to gather relevant context and apply a risk-based
 * decision framework before approving or denying the request.
 */
export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";

export type AskForApproval =
  | "untrusted"
  | "on-request"
  | {
      granular: {
        sandbox_approval: boolean;
        rules: boolean;
        skill_approval: boolean;
        request_permissions: boolean;
        mcp_elicitations: boolean;
      };
    }
  | "never";

export type DynamicToolSpec =
  | ({ type: "function" } & DynamicToolFunctionSpec)
  | ({ type: "namespace" } & DynamicToolNamespaceSpec);

export type DynamicToolFunctionSpec = {
  name: string;
  description: string;
  inputSchema: JsonValue;
  deferLoading?: boolean;
};

export type DynamicToolNamespaceSpec = {
  name: string;
  description: string;
  tools: Array<DynamicToolNamespaceTool>;
};

export type DynamicToolNamespaceTool = { type: "function" } & DynamicToolFunctionSpec;

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/**
 * A user-selected root that can expose one or more runtime capabilities.
 */
export type SelectedCapabilityRoot = {
  /**
   * Stable identifier supplied by the capability selection platform.
   */
  id: string;
  /**
   * Where the selected root can be resolved.
   */
  location: CapabilityRootLocation;
};

/**
 * Location used to resolve a selected capability root.
 */
export type CapabilityRootLocation = {
  type: "environment";
  environmentId: string;
  /**
   * Absolute path for the root in the selected environment.
   */
  path: string;
};

export type ThreadStartSource = "startup" | "clear";

export type TurnEnvironmentParams = {
  environmentId: string;
  cwd: LegacyAppPathString;
  /**
   * Environment-native runtime workspace roots. Omitted defaults to `cwd`.
   */
  runtimeWorkspaceRoots?: Array<LegacyAppPathString> | null;
};

export type ThreadStartResponse = {
  thread: Thread;
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: AbsolutePathBuf;
  /**
   * Thread-scoped runtime workspace roots used to materialize
   * `:workspace_roots`.
   */
  runtimeWorkspaceRoots: Array<AbsolutePathBuf>;
  /**
   * Environment-native paths to instruction source files currently loaded for this thread.
   */
  instructionSources: Array<LegacyAppPathString>;
  approvalPolicy: AskForApproval;
  /**
   * Reviewer currently used for approval requests on this thread.
   */
  approvalsReviewer: ApprovalsReviewer;
  /**
   * Legacy sandbox policy retained for compatibility. Experimental clients
   * should prefer `activePermissionProfile` for profile provenance.
   */
  sandbox: SandboxPolicy;
  /**
   * Named or implicit built-in profile that produced the active
   * permissions, when known.
   */
  activePermissionProfile: ActivePermissionProfile | null;
  reasoningEffort: ReasoningEffort | null;
  /**
   * @deprecated Always `explicitRequestOnly`. Use `reasoningEffort` for Ultra behavior.
   */
  multiAgentMode: MultiAgentMode;
};

export type ActivePermissionProfile = {
  /**
   * Identifier from `default_permissions` or the implicit built-in default,
   * such as `:workspace` or a user-defined `[permissions.<id>]` profile.
   */
  id: string;
  /**
   * Parent profile identifier from the selected permissions profile's
   * `extends` setting, when present.
   */
  extends: string | null;
};

export type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "readOnly"; networkAccess: boolean }
  | { type: "externalSandbox"; networkAccess: NetworkAccess }
  | {
      type: "workspaceWrite";
      writableRoots: Array<AbsolutePathBuf>;
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

export type NetworkAccess = "restricted" | "enabled";

/**
 * There are three ways to resume a thread:
 * 1. By thread_id: load the thread from disk by thread_id and resume it.
 * 2. By history: instantiate the thread from memory and resume it.
 * 3. By path: load the thread from disk by path and resume it.
 *
 * For non-running threads, the precedence is: history > non-empty path > thread_id.
 * If using history or a non-empty path for a non-running thread, the thread_id
 * param will be ignored.
 *
 * If thread_id identifies a running thread, app-server rejoins that thread and
 * treats a non-empty path as a consistency check against the active rollout path.
 * Empty string path values are treated as absent.
 *
 * Prefer using thread_id whenever possible.
 */
export type ThreadResumeParams = {
  threadId: string;
  /**
   * [UNSTABLE] FOR CODEX CLOUD - DO NOT USE.
   * If specified, the thread will be resumed with the provided history
   * instead of loaded from disk.
   */
  history?: Array<ResponseItem> | null;
  /**
   * [UNSTABLE] Specify the rollout path to resume from.
   * If specified for a non-running thread, the thread_id param will be ignored.
   * If thread_id identifies a running thread, the path must match the active
   * rollout path.
   */
  path?: string | null;
  /**
   * Configuration overrides for the resumed thread, if any.
   */
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  /**
   * Replace the thread's runtime workspace roots. Paths must be absolute.
   */
  runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null;
  approvalPolicy?: AskForApproval | null;
  /**
   * Override where approval requests are routed for review on this thread
   * and subsequent turns.
   */
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode | null;
  /**
   * Named profile id for the resumed thread. Cannot be combined with
   * `sandbox`.
   */
  permissions?: string | null;
  config?: { [key in string]?: JsonValue } | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: Personality | null;
  /**
   * When true, return only thread metadata and live-resume state without
   * populating `thread.turns`. This is useful when the client plans to call
   * `thread/turns/list` immediately after resuming. Full-history hydration
   * is deprecated for paginated threads; use this with `thread/turns/list`
   * and `thread/items/list` instead.
   */
  excludeTurns?: boolean;
  /**
   * When present, include a `thread/turns/list` page in the resume response
   * so clients can bootstrap recent turns without a second request.
   */
  initialTurnsPage?: ThreadResumeInitialTurnsPageParams | null;
};

export type ResponseItem =
  | {
      type: "message";
      id?: ResponseItemId;
      role: string;
      content: Array<ContentItem>;
      phase?: MessagePhase;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "agent_message";
      id?: ResponseItemId;
      author: string;
      recipient: string;
      content: Array<AgentMessageInputContent>;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "reasoning";
      id?: ResponseItemId;
      summary: Array<ReasoningItemReasoningSummary>;
      content?: Array<ReasoningItemContent>;
      encrypted_content: string | null;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "local_shell_call";
      /**
       * Legacy id field retained for compatibility with older payloads.
       */
      id?: ResponseItemId;
      /**
       * Set when using the Responses API.
       */
      call_id: string | null;
      status: LocalShellStatus;
      action: LocalShellAction;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "function_call";
      id?: ResponseItemId;
      name: string;
      namespace?: string;
      arguments: string;
      encrypted_function_args?: Array<string>;
      call_id: string;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "tool_search_call";
      id?: ResponseItemId;
      call_id: string | null;
      status?: string;
      execution: string;
      arguments: unknown;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "function_call_output";
      id?: ResponseItemId;
      call_id?: string;
      name?: string;
      namespace?: string;
      output: FunctionCallOutputBody;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "custom_tool_call";
      id?: ResponseItemId;
      status?: string;
      call_id: string;
      name: string;
      namespace?: string;
      input: string;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "custom_tool_call_output";
      id?: ResponseItemId;
      call_id: string;
      name?: string;
      output: FunctionCallOutputBody;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "tool_search_output";
      id?: ResponseItemId;
      call_id: string | null;
      status: string;
      execution: string;
      tools: unknown[];
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "web_search_call";
      id?: ResponseItemId;
      status?: string;
      action?: LegacyWebSearchAction;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "image_generation_call";
      id?: ResponseItemId;
      status: string;
      revised_prompt?: string;
      result: string;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | {
      type: "compaction";
      id?: ResponseItemId;
      encrypted_content: string;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | { type: "compaction_trigger" }
  | {
      type: "context_compaction";
      id?: ResponseItemId;
      encrypted_content?: string;
      internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough;
    }
  | { type: "other" };

export type AgentMessageInputContent =
  | { type: "input_text"; text: string }
  | { type: "encrypted_content"; encrypted_content: string };

export type ContentItem =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: ImageDetail }
  | { type: "input_audio"; audio_url: string }
  | { type: "output_text"; text: string };

/**
 * Internal Responses API passthrough metadata copied into underlying chat messages.
 *
 * Responses API strongly types this payload. Do not modify it without first getting API
 * approval and making the corresponding Responses API change.
 */
export type InternalChatMessageMetadataPassthrough = { turn_id?: string };

export type LocalShellAction = { type: "exec" } & LocalShellExecAction;

export type LocalShellExecAction = {
  command: Array<string>;
  timeout_ms: bigint | null;
  working_directory: string | null;
  env: { [key in string]?: string } | null;
  user: string | null;
};

export type LocalShellStatus = "completed" | "in_progress" | "incomplete";

export type ReasoningItemContent =
  | { type: "reasoning_text"; text: string }
  | { type: "text"; text: string };

export type ReasoningItemReasoningSummary = { type: "summary_text"; text: string };

/**
 * A Responses API item ID. New IDs require an explicit prefix; deserialization
 * remains permissive so legacy rollouts can still be read.
 */
export type ResponseItemId = string;

export type LegacyWebSearchAction =
  | { type: "search"; query?: string; queries?: Array<string> }
  | { type: "open_page"; url?: string }
  | { type: "find_in_page"; url?: string; pattern?: string }
  | { type: "other" };

export type ThreadResumeInitialTurnsPageParams = {
  /**
   * Optional turn page size.
   */
  limit?: number | null;
  /**
   * Optional turn pagination direction; defaults to descending.
   */
  sortDirection?: SortDirection | null;
  /**
   * How much item detail to include for each returned turn; defaults to summary.
   */
  itemsView?: TurnItemsView | null;
};

export type ThreadResumeResponse = {
  thread: Thread;
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: AbsolutePathBuf;
  /**
   * Thread-scoped runtime workspace roots used to materialize
   * `:workspace_roots`.
   */
  runtimeWorkspaceRoots: Array<AbsolutePathBuf>;
  /**
   * Environment-native paths to instruction source files currently loaded for this thread.
   */
  instructionSources: Array<LegacyAppPathString>;
  approvalPolicy: AskForApproval;
  /**
   * Reviewer currently used for approval requests on this thread.
   */
  approvalsReviewer: ApprovalsReviewer;
  /**
   * Legacy sandbox policy retained for compatibility. Experimental clients
   * should prefer `activePermissionProfile` for profile provenance.
   */
  sandbox: SandboxPolicy;
  /**
   * Named or implicit built-in profile that produced the active
   * permissions, when known.
   */
  activePermissionProfile: ActivePermissionProfile | null;
  reasoningEffort: ReasoningEffort | null;
  /**
   * @deprecated Always `explicitRequestOnly`. Use `reasoningEffort` for Ultra behavior.
   */
  multiAgentMode: MultiAgentMode;
  /**
   * `thread/turns/list` page returned when requested by `initialTurnsPage`.
   */
  initialTurnsPage: TurnsPage | null;
  /**
   * Opaque cursor for hydrating paginated turns backwards.
   *
   * Pass this as `cursor` to `thread/turns/list` with
   * `sortDirection: "desc"`. The first page includes the turn identified by the cursor.
   */
  turnsBackwardsCursor: string | null;
  /**
   * Opaque cursor for hydrating paginated items backwards.
   *
   * Pass this as `cursor` to `thread/items/list` with
   * `sortDirection: "desc"`. The first page includes the item identified by the cursor.
   */
  itemsBackwardsCursor: string | null;
};

export type TurnsPage = {
  data: Array<Turn>;
  nextCursor: string | null;
  backwardsCursor: string | null;
};

export type ThreadReadParams = {
  threadId: string;
  /**
   * When true, include turns and their items from rollout history.
   * Full-history hydration is deprecated for paginated threads; prefer a
   * metadata-only read and page with `thread/turns/list` and
   * `thread/items/list`.
   */
  includeTurns?: boolean;
};

export type ThreadReadResponse = { thread: Thread };

export type ThreadTurnsListParams = {
  threadId: string;
  /**
   * Opaque cursor to pass to the next call to continue after the last turn.
   */
  cursor?: string | null;
  /**
   * Optional turn page size.
   */
  limit?: number | null;
  /**
   * Optional turn pagination direction; defaults to descending.
   */
  sortDirection?: SortDirection | null;
  /**
   * How much item detail to include for each returned turn; defaults to summary.
   */
  itemsView?: TurnItemsView | null;
};

export type ThreadTurnsListResponse = {
  data: Array<Turn>;
  /**
   * Opaque cursor to pass to the next call to continue after the last turn.
   * if None, there are no more turns to return.
   */
  nextCursor: string | null;
  /**
   * Opaque cursor to pass as `cursor` when reversing `sortDirection`.
   * This is only populated when the page contains at least one turn.
   * Use it with the opposite `sortDirection` to include the anchor turn again
   * and catch updates to that turn.
   */
  backwardsCursor: string | null;
};

export type ThreadSetNameParams = { threadId: string; name: string };

export type ThreadSetNameResponse = Record<string, never>;

export type ThreadDeleteParams = { threadId: string };

export type ThreadDeleteResponse = Record<string, never>;

export type ThreadUnsubscribeParams = { threadId: string };

export type ThreadUnsubscribeResponse = { status: ThreadUnsubscribeStatus };

export type ThreadUnsubscribeStatus = "notLoaded" | "notSubscribed" | "unsubscribed";

/**
 * Replace a paginated thread's durable history with the prefix before one turn.
 *
 * This only changes persisted conversation history. It does not revert local file changes.
 */
export type ThreadRevertParams = {
  threadId: string;
  /**
   * Turn excluded from the replacement history, together with every later turn.
   */
  beforeTurnId: string;
};

export type ThreadRevertResponse = {
  /**
   * Updated loaded thread metadata. `turns` is always empty; hydrate retained history through
   * `thread/turns/list`.
   */
  thread: Thread;
  /**
   * Opaque cursor for hydrating paginated turns backwards.
   *
   * Pass this as `cursor` to `thread/turns/list` with
   * `sortDirection: "desc"`. The first page includes the turn identified by the cursor.
   */
  turnsBackwardsCursor: string | null;
  /**
   * Opaque cursor for hydrating paginated items backwards.
   *
   * Pass this as `cursor` to `thread/items/list` with
   * `sortDirection: "desc"`. The first page includes the item identified by the cursor.
   */
  itemsBackwardsCursor: string | null;
};

/**
 * DEPRECATED: `thread/rollback` will be removed soon.
 */
export type ThreadRollbackParams = {
  threadId: string;
  /**
   * The number of turns to drop from the end of the thread. Must be >= 1.
   *
   * This only modifies the thread's history and does not revert local file changes
   * that have been made by the agent. Clients are responsible for reverting these changes.
   */
  numTurns: number;
};

export type ThreadRollbackResponse = {
  /**
   * The updated thread after applying the rollback, with `turns` populated.
   *
   * The ThreadItems stored in each Turn are lossy since we explicitly do not
   * persist all agent interactions, such as command executions. This is the same
   * behavior as `thread/resume`.
   */
  thread: Thread;
};

export type TurnStartParams = {
  threadId: string;
  clientUserMessageId?: string | null;
  input: Array<UserInput>;
  /**
   * Optional source classification for the caller that starts this turn.
   * Ignored when this request steers an already-active turn.
   */
  turnTrigger?: string | null;
  toolOutput?: TurnToolOutput | null;
  /**
   * Optional metadata to enrich Codex's ResponsesAPI turn metadata.
   *
   * Entries are flattened into the JSON string sent as
   * `client_metadata["x-codex-turn-metadata"]` on ResponsesAPI HTTP and websocket requests.
   *
   * They are not sent as top-level ResponsesAPI `client_metadata` keys, and reserved keys
   * such as `session_id`, `thread_id`, `turn_id`, and `window_id` cannot be overridden.
   */
  responsesapiClientMetadata?: { [key in string]?: string } | null;
  /**
   * Optional client-provided context fragments keyed by an opaque source identifier.
   */
  additionalContext?: { [key in string]?: AdditionalContextEntry } | null;
  /**
   * Optional environments for this turn and subsequent turns.
   *
   * Omitted uses the thread sticky environments. Empty disables
   * environment access for this turn. Non-empty selects the first
   * environment as the current turn environment for this turn.
   */
  environments?: Array<TurnEnvironmentParams> | null;
  /**
   * Override the working directory for this turn and subsequent turns.
   */
  cwd?: string | null;
  /**
   * Replace the thread's runtime workspace roots for this turn and
   * subsequent turns. Paths must be absolute.
   */
  runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null;
  /**
   * Override the approval policy for this turn and subsequent turns.
   */
  approvalPolicy?: AskForApproval | null;
  /**
   * Override where approval requests are routed for review on this turn and
   * subsequent turns.
   */
  approvalsReviewer?: ApprovalsReviewer | null;
  /**
   * Override the sandbox policy for this turn and subsequent turns.
   */
  sandboxPolicy?: SandboxPolicy | null;
  /**
   * Select a named permissions profile id for this turn and subsequent
   * turns. Cannot be combined with `sandboxPolicy`.
   */
  permissions?: string | null;
  /**
   * Override the model for this turn and subsequent turns.
   */
  model?: string | null;
  /**
   * Override the service tier for this turn and subsequent turns.
   */
  serviceTier?: string | null;
  /**
   * Override the service tier only when this request starts a new turn.
   * Use "default" for standard speed. Omitted or null inherits the thread's tier.
   * Does not change the thread's tier or a turn being steered.
   */
  serviceTierForTurn?: string | null;
  /**
   * Override the reasoning effort for this turn and subsequent turns.
   */
  effort?: ReasoningEffort | null;
  /**
   * Override the reasoning summary for this turn and subsequent turns.
   */
  summary?: ReasoningSummary | null;
  /**
   * Override the personality for this turn and subsequent turns.
   */
  personality?: Personality | null;
  /**
   * Optional JSON Schema used to constrain the final assistant message for
   * this turn.
   */
  outputSchema?: JsonValue | null;
  /**
   * EXPERIMENTAL - Set a pre-set collaboration mode.
   * Takes precedence over model, reasoning_effort, and developer instructions if set.
   *
   * For `collaboration_mode.settings.developer_instructions`, `null` means
   * "use the built-in instructions for the selected mode".
   */
  collaborationMode?: CollaborationMode | null;
  /**
   * @deprecated Ignored. Use `effort: "ultra"` for proactive multi-agent behavior.
   */
  multiAgentMode?: MultiAgentMode | null;
  /**
   * EXPERIMENTAL - Request a workspace-authorized cyber program for this
   * turn. Omission preserves automatic behavior. This does not grant access.
   */
  cyberAccessProgram?: CyberAccessProgram | null;
};

/**
 * Collaboration mode for a Codex session.
 */
export type CollaborationMode = { mode: ModeKind; settings: Settings };

/**
 * Initial collaboration mode to use when the TUI starts.
 */
export type ModeKind = "plan" | "default";

/**
 * Settings for a collaboration mode.
 */
export type Settings = {
  model: string;
  reasoning_effort: ReasoningEffort | null;
  developer_instructions: string | null;
};

/**
 * A summary of the reasoning performed by the model. This can be useful for
 * debugging and understanding the model's reasoning process.
 * See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#reasoning-summaries
 */
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";

export type AdditionalContextEntry = { value: string; kind: AdditionalContextKind };

export type AdditionalContextKind = "untrusted" | "application";

/**
 * Requested cyber treatment for a ChatGPT-authenticated Codex turn.
 * Authorization and model-tier restrictions remain server-owned.
 */
export type CyberAccessProgram = "standard" | "daybreakBlue" | "daybreakRed";

export type TurnToolOutput = {
  name: string;
  namespace: string | null;
  output: FunctionCallOutputBody;
};

export type TurnStartResponse = { turn: Turn };

export type TurnSteerParams = {
  threadId: string;
  clientUserMessageId?: string | null;
  input: Array<UserInput>;
  /**
   * Optional metadata to enrich Codex's ResponsesAPI turn metadata.
   *
   * Entries are flattened into the JSON string sent as
   * `client_metadata["x-codex-turn-metadata"]` on ResponsesAPI HTTP and websocket requests.
   *
   * They are not sent as top-level ResponsesAPI `client_metadata` keys, and reserved keys
   * such as `session_id`, `thread_id`, `turn_id`, and `window_id` cannot be overridden.
   */
  responsesapiClientMetadata?: { [key in string]?: string } | null;
  /**
   * Optional client-provided context fragments keyed by an opaque source identifier.
   */
  additionalContext?: { [key in string]?: AdditionalContextEntry } | null;
  /**
   * Required active turn id precondition. The request fails when it does not
   * match the currently active turn.
   */
  expectedTurnId: string;
};

export type TurnSteerResponse = { turnId: string };

export type TurnInterruptParams = { threadId: string; turnId: string };

export type TurnInterruptResponse = Record<string, never>;

export type DynamicToolCallParams = {
  threadId: string;
  turnId: string;
  callId: string;
  namespace: string | null;
  tool: string;
  arguments: JsonValue;
};

export type DynamicToolCallResponse = {
  contentItems: Array<DynamicToolCallOutputContentItem>;
  success: boolean;
};

/**
 * EXPERIMENTAL. Params sent with a request_user_input event.
 */
export type ToolRequestUserInputParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: Array<ToolRequestUserInputQuestion>;
  isBlocking: boolean;
  /**
   * @deprecated Use `isBlocking` to decide whether the request should block.
   */
  autoResolutionMs: number | null;
};

/**
 * EXPERIMENTAL. Represents one request_user_input question and its required options.
 */
export type ToolRequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<ToolRequestUserInputOption> | null;
};

/**
 * EXPERIMENTAL. Defines a single selectable option for request_user_input.
 */
export type ToolRequestUserInputOption = { label: string; description: string };

/**
 * EXPERIMENTAL. Response payload mapping question ids to answers.
 */
export type ToolRequestUserInputResponse = {
  answers: { [key in string]?: ToolRequestUserInputAnswer };
};

/**
 * EXPERIMENTAL. Captures a user's answer to a request_user_input question.
 */
export type ToolRequestUserInputAnswer = { answers: Array<string> };

export type ItemCompletedNotification = {
  item: ThreadItem;
  threadId: string;
  turnId: string;
  /**
   * Unix timestamp (in milliseconds) when this item lifecycle completed.
   */
  completedAtMs: number;
};

export type ThreadStartedNotification = { thread: Thread };

export type TurnStartedNotification = { threadId: string; turn: Turn };

export type TurnCompletedNotification = { threadId: string; turn: Turn };

export type TurnPlanUpdatedNotification = {
  threadId: string;
  turnId: string;
  explanation: string | null;
  plan: Array<TurnPlanStep>;
};

export type TurnPlanStep = { step: string; status: TurnPlanStepStatus };

export type TurnPlanStepStatus = "pending" | "inProgress" | "completed";

export type AgentMessageDeltaNotification = {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
};

export type ReasoningTextDeltaNotification = {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  contentIndex: number;
};

export type ServerRequestResolvedNotification = { threadId: string; requestId: RequestId };

export type RequestId = string | number;

export type ThreadNameUpdatedNotification = { threadId: string; threadName?: string };

export type CodexMethods = {
  initialize: { params: InitializeParams; result: InitializeResponse };
  "model/list": { params: ModelListParams; result: ModelListResponse };
  "account/read": { params: GetAccountParams; result: GetAccountResponse };
  "skills/list": { params: SkillsListParams; result: SkillsListResponse };
  "thread/list": { params: ThreadListParams; result: ThreadListResponse };
  "thread/start": { params: ThreadStartParams; result: ThreadStartResponse };
  "thread/resume": { params: ThreadResumeParams; result: ThreadResumeResponse };
  "thread/read": { params: ThreadReadParams; result: ThreadReadResponse };
  "thread/turns/list": { params: ThreadTurnsListParams; result: ThreadTurnsListResponse };
  "thread/name/set": { params: ThreadSetNameParams; result: ThreadSetNameResponse };
  "thread/delete": { params: ThreadDeleteParams; result: ThreadDeleteResponse };
  "thread/unsubscribe": { params: ThreadUnsubscribeParams; result: ThreadUnsubscribeResponse };
  "thread/revert": { params: ThreadRevertParams; result: ThreadRevertResponse };
  "thread/rollback": { params: ThreadRollbackParams; result: ThreadRollbackResponse };
  "turn/start": { params: TurnStartParams; result: TurnStartResponse };
  "turn/steer": { params: TurnSteerParams; result: TurnSteerResponse };
  "turn/interrupt": { params: TurnInterruptParams; result: TurnInterruptResponse };
};
