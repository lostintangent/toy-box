import {
  Documint,
  type CommentChange,
  type DocumentPresence,
  type DocumentUser,
  type EditorTheme,
} from "@lostintangent/documint";
import type { JSONType } from "zod";
import type { EditorProps } from "../index";
import { usePreferredColorScheme } from "@/shared/hooks/usePreferredColorScheme";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { buildArtifactCommentPrompt } from "./comments";

const COPILOT_USER = {
  id: "copilot",
  username: "copilot",
  fullName: "Copilot",
} satisfies DocumentUser;
const DOCUMINT_USERS = [COPILOT_USER];

/** Rich Markdown editing with live external diffs and inline Copilot responses. */
export function MarkdownEditor({ mode, file, pendingWorkers, spawnWorker }: EditorProps) {
  const theme = useDocumintTheme();
  const presence: DocumentPresence[] = pendingWorkers.flatMap((worker) => {
    const threadId = artifactCommentThreadId(worker.metadata);
    return threadId ? [{ userId: COPILOT_USER.id, cursor: { threadId }, color: "#8b5cf6" }] : [];
  });

  async function handleCommentChanged(change: CommentChange) {
    if (change.kind !== "added" || !spawnWorker) {
      await file.flush({ notifyAgent: false });
      return;
    }

    await spawnWorker({
      name: "Respond to comment",
      prompt: buildArtifactCommentPrompt(change.thread, new Date()),
      metadata: { threadId: change.threadId },
    });
  }

  return (
    <Documint
      content={file.content ?? ""}
      onCommentChanged={handleCommentChanged}
      onContentChanged={file.save}
      readOnly={mode === "read"}
      users={DOCUMINT_USERS}
      presence={presence}
      showDiffs={mode !== "edit"}
      theme={theme}
    />
  );
}

function artifactCommentThreadId(metadata: JSONType | undefined): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return typeof metadata.threadId === "string" ? metadata.threadId : undefined;
}

function useDocumintTheme(): EditorTheme {
  // Re-read computed theme tokens whenever their media query changes.
  usePreferredColorScheme();
  const accentColor = useWorkspaceSelector((workspace) => workspace.settings.accentColor);

  return {
    accent: accentColor,
    background: readThemeColor("--background"),
    fontSize: 14,
    muted: readThemeColor("--muted-foreground"),
    text: readThemeColor("--foreground"),
  };
}

function readThemeColor(variableName: `--${string}`): string {
  if (typeof document === "undefined") return `var(${variableName})`;

  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  if (!value) throw new Error(`Missing Toy Box theme color: ${variableName}`);
  return value;
}
