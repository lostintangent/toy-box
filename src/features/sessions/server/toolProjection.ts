// Domain effects of Toy Box tools, applied over every provider's canonical
// events, live and on history replay.
import type { SessionEvent, ToolCall } from "@sessions/model";
import { isAbsolute } from "node:path";
import { projectSessionArtifactPath, workspaceFileFromAbsolutePath } from "@files/server/paths";
import { parsePatchTouchedFiles } from "@sessions/model/fileDiffs";
import { previewUpdateSchema } from "@/shared/preview";
import { z } from "zod";

// How each Toy Box tool call projects, keyed by canonical tool name. Tools not
// listed here are plain visible tool calls. Plain entries apply unconditionally;
// function entries decide per call from the tool arguments.
const TOOL_CALL_POLICIES: Record<string, ToolCallPolicyEntry | undefined> = {
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
  set_session_preview: { kind: "translated", projectOnComplete: projectPreview },
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

// How a tool call's lifecycle projects, decided from its name and arguments at
// tool_start. The projector keeps it until tool_end, which carries no tool name.
type ToolCallPolicy =
  | { kind: "omitted" }
  | {
      kind: "translated";
      // Domain events that replace the call when it starts / completes.
      projectOnStart?: SessionEvent[];
      projectOnComplete?: (end: ToolEnd) => SessionEvent[];
    };

type ToolEnd = Extract<SessionEvent, { type: "tool_end" }>;
type ToolArguments = ToolCall["arguments"];
type ToolCallPolicyEntry =
  | ToolCallPolicy
  | ((args: ToolArguments, sessionId: string) => ToolCallPolicy | undefined);

/** Create one session's transform from canonical provider events to domain
 *  events: Toy Box tool calls become their effects, and everything else,
 *  including a completion whose start it never saw, passes through. */
export function createToolCallProjector(
  sessionId: string,
): (event: SessionEvent) => SessionEvent[] {
  const calls = new Map<string, ToolCallPolicy>();
  return (event) => {
    switch (event.type) {
      case "tool_start": {
        const entry = TOOL_CALL_POLICIES[event.toolName];
        const policy = typeof entry === "function" ? entry(event.arguments, sessionId) : entry;
        if (!policy) return [event];
        calls.set(callKey(event), policy);
        return policy.kind === "translated" ? (policy.projectOnStart ?? []) : [];
      }
      case "tool_end": {
        const key = callKey(event);
        const policy = calls.get(key);
        if (!policy) return [event];
        calls.delete(key);
        return policy.kind === "translated" ? (policy.projectOnComplete?.(event) ?? []) : [];
      }
      default:
        return [event];
    }
  };
}

// A subagent's call IDs are only unique within its parent call.
function callKey(event: { toolCallId: string; parentToolCallId?: string }) {
  return `${event.parentToolCallId ?? ""}/${event.toolCallId}`;
}

function projectFileVisibility(
  args: ToolArguments,
  type: "file_opened" | "file_closed",
): ToolCallPolicy {
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
  sessionId: string,
): ToolCallPolicy | undefined {
  return projectSessionArtifactPath(sessionId, readPathArg(args)) ? { kind: "omitted" } : undefined;
}

function projectPatchPolicy(args: ToolArguments, sessionId: string): ToolCallPolicy | undefined {
  const patch = readStringArg(args, "patch");
  const files = patch ? parsePatchTouchedFiles(patch) : [];
  return files.length > 0 && files.every((file) => projectSessionArtifactPath(sessionId, file.path))
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

const createdSessionSchema = z.object({ sessionId: z.string(), opened: z.boolean() });

function projectCreatedSession(end: ToolEnd): SessionEvent[] {
  if (!end.success) return [];
  const result = createdSessionSchema.safeParse(readToolResult(end));
  return result.success && result.data.opened
    ? [{ type: "linked_session_added", sessionId: result.data.sessionId }]
    : [];
}

function projectPreview(end: ToolEnd): SessionEvent[] {
  if (!end.success) return [];
  const result = previewUpdateSchema.strip().safeParse(readToolResult(end));
  return result.success ? [{ type: "preview_changed", preview: result.data.preview }] : [];
}

function readToolResult(end: ToolEnd): unknown {
  const raw = end.details ?? end.result;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
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
