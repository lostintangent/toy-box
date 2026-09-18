// Domain effects of Toy Box tools, shared by every provider and history replay.
import type { SessionEvent, ToolCall } from "@sessions/model";
import { isAbsolute } from "node:path";
import { projectSessionArtifactPath, workspaceFileFromAbsolutePath } from "@files/server/paths";
import { parsePatchTouchedFiles } from "@sessions/model/fileDiffs";

export type ToolCompletion = {
  success: boolean;
  result?: string;
  details?: string;
};

// How each tool call projects, keyed by CANONICAL name (post-alias — the
// SDK's "task" resolves the "agent" policy). Tools not listed here are plain
// visible tool calls. Plain entries apply unconditionally; function entries
// decide per call from the tool arguments (factories live in the "Tool call
// policy resolution" section below).
const TOOL_CALL_POLICIES: Record<string, ToolCallPolicyEntry | undefined> = {
  skill: { kind: "omitted" },
  read_agent: { kind: "omitted" },
  write_agent: { kind: "omitted" },
  list_agents: { kind: "omitted" },
  check_session_status: { kind: "omitted" },
  wait_for_sessions: { kind: "omitted" },
  deliver_message: { kind: "omitted" },
  send_to_inbox: { kind: "omitted" },
  list_automations: { kind: "omitted" },
  create_automation: { kind: "omitted" },
  update_automation: { kind: "omitted" },
  run_automation: { kind: "omitted" },
  read: projectArtifactFilePolicy,
  create: projectArtifactFilePolicy,
  edit: projectArtifactFilePolicy,
  patch: projectPatchPolicy,
  open_file: (args) => projectFileVisibility(args, "file_opened"),
  close_file: (args) => projectFileVisibility(args, "file_closed"),
  create_session: { kind: "translated", projectOnComplete: projectCreatedSession },
  spawn_worker: { kind: "translated", projectOnComplete: projectCreatedSession },
  open_session: (args) => ({
    kind: "translated",
    projectOnStart: projectLinkedSessionEvent(args, "linked_session_added"),
  }),
  close_session: (args) => ({
    kind: "translated",
    projectOnStart: projectLinkedSessionEvent(args, "linked_session_removed"),
  }),
  delete_session: (args) => ({
    kind: "translated",
    projectOnStart: projectLinkedSessionEvent(args, "linked_session_removed"),
  }),
};

// How a tool call's lifecycle should project, based on its name + arguments.
// `undefined` means a plain visible tool call. Policies are stored
// in ProjectionState keyed by toolCallId, because later lifecycle events
// (progress/complete) don't carry the tool name.
export type ToolCallProjectionPolicy =
  | { kind: "omitted" }
  | {
      kind: "translated";
      // Synthetic events to emit when the call starts / completes.
      projectOnStart?: SessionEvent[];
      projectOnComplete?: (eventData: ToolCompletion) => SessionEvent[];
    };

type ToolArguments = ToolCall["arguments"];
type ToolCallPolicyFactory = (
  args: ToolArguments,
  state: { sessionId: string },
) => ToolCallProjectionPolicy | undefined;
type ToolCallPolicyEntry = ToolCallProjectionPolicy | ToolCallPolicyFactory;

export function resolveToolCallPolicy(
  toolName: string,
  args: ToolArguments,
  state: { sessionId: string },
): ToolCallProjectionPolicy | undefined {
  const entry = TOOL_CALL_POLICIES[toolName];
  if (!entry) return undefined;
  return typeof entry === "function" ? entry(args, state) : entry;
}

function projectFileVisibility(
  args: ToolArguments,
  type: "file_opened" | "file_closed",
): ToolCallProjectionPolicy {
  const path = readStringArg(args, "path")?.trim();
  return {
    kind: "translated",
    projectOnComplete: ({ success }) =>
      success && path && isAbsolute(path)
        ? [{ type, file: workspaceFileFromAbsolutePath(path) }]
        : [],
  };
}

function projectArtifactFilePolicy(
  args: ToolArguments,
  state: { sessionId: string },
): ToolCallProjectionPolicy | undefined {
  const artifactPath = projectSessionArtifactPath(state.sessionId, readPathArg(args));
  if (!artifactPath) return undefined;

  return { kind: "omitted" };
}

function projectPatchPolicy(
  args: ToolArguments,
  state: { sessionId: string },
): ToolCallProjectionPolicy | undefined {
  const patch = readStringArg(args, "patch");
  const files = patch ? parsePatchTouchedFiles(patch) : [];
  return files.length > 0 &&
    files.every((file) => projectSessionArtifactPath(state.sessionId, file.path))
    ? { kind: "omitted" }
    : undefined;
}

function projectLinkedSessionEvent(
  args: Record<string, unknown> | undefined,
  type: "linked_session_added" | "linked_session_removed",
): SessionEvent[] {
  const sessionId = readStringArg(args, "sessionId");
  return sessionId ? [{ type, sessionId }] : [];
}

function projectCreatedSession(eventData: ToolCompletion): SessionEvent[] {
  if (!eventData.success) return [];
  const result = readCreatedSessionResult(eventData);
  return result?.opened ? [{ type: "linked_session_added", sessionId: result.sessionId }] : [];
}

function readCreatedSessionResult(
  eventData: ToolCompletion,
): { sessionId: string; opened: boolean } | undefined {
  const raw = eventData.details ?? eventData.result;
  if (!raw) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

    const result = parsed as Record<string, unknown>;
    const sessionId = result.sessionId;
    if (typeof sessionId !== "string") return undefined;
    if (typeof result.opened !== "boolean") return undefined;

    return {
      sessionId,
      opened: result.opened,
    };
  } catch {
    return undefined;
  }
}

function readStringArg(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const result = value?.[key];
  return typeof result === "string" ? result : undefined;
}

function readPathArg(value: Record<string, unknown> | undefined): string | undefined {
  return readStringArg(value, "path") ?? readStringArg(value, "filePath");
}
