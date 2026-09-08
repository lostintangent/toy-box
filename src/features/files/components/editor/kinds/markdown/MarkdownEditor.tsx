import {
  Documint,
  type CommentChange,
  type DocumentPresence,
  type DocumentUser,
  type EditorTheme,
} from "@lostintangent/documint";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { JSONType } from "zod";
import { agentHandleFromName } from "@agents/model";
import { fileMutations } from "@files/mutations";
import { agentQueries } from "@agents/queries";
import type { EditorProps } from "../index";
import { usePreferredColorScheme } from "@/shared/hooks/usePreferredColorScheme";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { COPILOT_DOCUMENT_USER_ID, planArtifactCommentResponse } from "./comments";

const COPILOT_USER = {
  id: COPILOT_DOCUMENT_USER_ID,
  username: "copilot",
  fullName: "Copilot",
} satisfies DocumentUser;
/** Rich Markdown editing with live external diffs and inline Copilot responses. */
export function MarkdownEditor({ mode, file, pendingWorkers, spawnWorker }: EditorProps) {
  const theme = useDocumintTheme();
  const fileHost =
    file.source.kind === "session"
      ? {
          kind: "file" as const,
          sessionId: file.source.sessionId,
          path: file.source.path,
        }
      : undefined;
  const agentsQuery = useQuery({ ...agentQueries.list(), enabled: fileHost !== undefined });
  const mentionAgent = useMutation(fileMutations.mentionAgent());
  const agents = fileHost ? (agentsQuery.data ?? []) : [];
  const users: DocumentUser[] = [
    COPILOT_USER,
    ...agents.map((agent) => ({
      id: agent.id,
      username: agentHandleFromName(agent.name),
      fullName: agent.name,
    })),
  ];
  const presence: DocumentPresence[] = [
    ...pendingWorkers.flatMap((worker) => {
      const threadId = artifactCommentThreadId(worker.metadata);
      return threadId
        ? [
            {
              userId: COPILOT_USER.id,
              cursor: { threadId },
              color: "#8b5cf6",
              status: "Copilot is working…",
            },
          ]
        : [];
    }),
  ];

  async function handleCommentChanged(change: CommentChange) {
    const plan = planArtifactCommentResponse(
      change,
      agents.map(({ id }) => id),
      new Date(),
    );
    if (!plan) {
      await file.flush({ notifyAgent: false });
      return;
    }

    const responses: Promise<unknown>[] = [];
    if (fileHost) {
      await file.flush({ notifyAgent: false });
      responses.push(
        ...plan.agentIds.map((agentId) =>
          mentionAgent.mutateAsync({
            host: fileHost,
            agentId,
            prompt: plan.prompt,
          }),
        ),
      );
    }
    if (plan.spawnWorker && spawnWorker) {
      responses.push(
        spawnWorker({
          name: "Respond to comment",
          prompt: plan.prompt,
          metadata: { threadId: plan.threadId },
        }),
      );
    }
    if (responses.length === 0) {
      await file.flush({ notifyAgent: false });
      return;
    }
    await Promise.all(responses);
  }

  return (
    <Documint
      content={file.content ?? ""}
      onCommentChanged={handleCommentChanged}
      onContentChanged={file.save}
      readOnly={mode === "read"}
      users={users}
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
