import {
  Documint,
  type CommentChange,
  type DocumentPresence,
  type DocumentUser,
  type EditorTheme,
} from "documint";
import type { AccentColor, JsonValue } from "@/types";
import type { ArtifactRendererProps } from "../index";
import {
  usePreferredColorScheme,
  type PreferredColorScheme,
} from "@/hooks/browser/usePreferredColorScheme";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import { buildArtifactCommentPrompt } from "./comments";

const COPILOT_USER = {
  id: "copilot",
  username: "copilot",
  fullName: "Copilot",
} satisfies DocumentUser;
const DOCUMINT_USERS = [COPILOT_USER];

/** Rich Markdown editing with live external diffs and inline Copilot responses. */
export function MarkdownArtifact({
  mode,
  artifact,
  pendingWorkers,
  spawnWorker,
}: ArtifactRendererProps) {
  const theme = useDocumintTheme();
  const presence: DocumentPresence[] = pendingWorkers.flatMap((worker) => {
    const threadId = artifactCommentThreadId(worker.metadata);
    return threadId ? [{ userId: COPILOT_USER.id, cursor: { threadId }, color: "#8b5cf6" }] : [];
  });

  async function handleCommentChanged(change: CommentChange) {
    if (change.kind !== "added") {
      await artifact.flush({ notifyAgent: false });
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
      content={artifact.content ?? ""}
      onCommentChanged={handleCommentChanged}
      onContentChanged={artifact.save}
      readOnly={mode === "read"}
      users={DOCUMINT_USERS}
      presence={presence}
      showDiffs={mode !== "edit"}
      theme={theme}
    />
  );
}

function artifactCommentThreadId(metadata: JsonValue | undefined): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return typeof metadata.threadId === "string" ? metadata.threadId : undefined;
}

const DOCUMINT_THEME_FALLBACKS = {
  light: {
    accent: "oklch(0.708 0 0)",
    background: "oklch(1 0 0)",
    externalChangeAdditionBackground: "rgba(34, 197, 94, 0.18)",
    externalChangeModificationBackground: "rgba(59, 130, 246, 0.18)",
    muted: "oklch(0.556 0 0)",
    text: "oklch(0.145 0 0)",
  },
  dark: {
    accent: "oklch(0.556 0 0)",
    background: "oklch(0.145 0 0)",
    externalChangeAdditionBackground: "rgba(34, 197, 94, 0.24)",
    externalChangeModificationBackground: "rgba(96, 165, 250, 0.24)",
    muted: "oklch(0.708 0 0)",
    text: "oklch(0.985 0 0)",
  },
} satisfies Record<PreferredColorScheme, EditorTheme>;
const DOCUMINT_FONT_SIZE = 14;

function useDocumintTheme(): EditorTheme {
  const colorScheme = usePreferredColorScheme();
  const accentColor = useWorkspaceSelector((workspace) => workspace.settings.accentColor);

  return createDocumintTheme(colorScheme, accentColor);
}

function createDocumintTheme(
  colorScheme: PreferredColorScheme,
  accentColor: AccentColor,
): EditorTheme {
  const fallback = DOCUMINT_THEME_FALLBACKS[colorScheme];

  return {
    accent: accentColor,
    background: readThemeColor("--background", fallback.background),
    externalChangeAdditionBackground: fallback.externalChangeAdditionBackground,
    externalChangeModificationBackground: fallback.externalChangeModificationBackground,
    fontSize: DOCUMINT_FONT_SIZE,
    muted: readThemeColor("--muted-foreground", fallback.muted),
    text: readThemeColor("--foreground", fallback.text),
  };
}

function readThemeColor(variableName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;

  return (
    getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback
  );
}
