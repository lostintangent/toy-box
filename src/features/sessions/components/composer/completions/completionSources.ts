import type { ComponentType } from "react";
import { getPathDirname } from "@files/model/paths";
import { fileQueries } from "@files/queries";
import { encodeReference } from "@/shared/references";
import {
  wordTrigger,
  type CompletionItem,
  type CompletionSource,
} from "@/shared/composers/completions/useCompletions";
import type { Session, SessionSkill, SessionsState } from "../../../model";
import { fileReference, sessionReference } from "../../../model/references";
import { selectTopLevelSessions, sessionQueries, skillQueries } from "../../../queries";
import { promptReferenceKinds } from "../../references/PromptReferences";

export type PromptCompletionItem = CompletionItem & {
  icon?: ComponentType<{ className?: string }>;
  updatedAt?: Date;
  badge?: string;
  filePath?: string;
};

/**
 * Skills, sessions, and files, each projected from its existing catalog query. Inbox composes
 * before a session exists, so the session ID is optional.
 */
export function promptCompletionSources({
  sessionId,
  directory,
  provider,
  hyperSessionId,
}: {
  sessionId?: string;
  directory?: string;
  provider?: string;
  hyperSessionId: string | null;
}): CompletionSource<PromptCompletionItem>[] {
  return [
    {
      id: "skill",
      trigger: /^\/([^\s/]*)/,
      empty: "No matching skills.",
      query: (query) => ({
        ...skillQueries.list(directory, provider),
        select: (skills: SessionSkill[]) =>
          skills
            .filter((skill) =>
              [skill.name, skill.description].some((text) =>
                text.toLowerCase().includes(query.toLowerCase()),
              ),
            )
            .map((skill) => ({
              value: `/${skill.name}`,
              label: `/${skill.name}`,
              description: skill.description,
              badge: directory && skill.type === "global" ? "Global" : undefined,
              filePath: skill.path,
            })),
      }),
    },
    {
      id: "session",
      trigger: wordTrigger("@"),
      empty: "No matching sessions.",
      query: (query) => ({
        ...sessionQueries.state,
        select: (state: SessionsState) =>
          matchSessions(selectTopLevelSessions(state, hyperSessionId), query, sessionId).map(
            (session) => {
              const reference = sessionReference(session);
              return {
                value: encodeReference(reference),
                label: reference.label,
                icon: promptReferenceKinds.session.Icon,
                updatedAt: session.updatedAt,
              };
            },
          ),
      }),
    },
    {
      id: "file",
      trigger: wordTrigger("#"),
      empty: "No matching files.",
      debounceMs: 150,
      query: (query) =>
        directory === undefined
          ? []
          : {
              ...fileQueries.search(directory, query),
              select: (paths: string[]) =>
                paths.map((path) => {
                  const reference = fileReference(path);
                  const folder = getPathDirname(path);
                  return {
                    value: encodeReference(reference),
                    label: reference.label,
                    icon: promptReferenceKinds.file.Icon,
                    detail: folder === "." ? undefined : folder,
                  };
                }),
            },
    },
  ];
}

/** Sessions a prompt can reference by title, newest first, excluding itself and drafts. */
function matchSessions(
  sessions: readonly Session[],
  query: string,
  currentSessionId?: string,
): Session[] {
  const normalized = query.toLowerCase();
  return sessions
    .filter(
      (session) =>
        session.provider &&
        session.id !== currentSessionId &&
        (session.title || session.id).toLowerCase().includes(normalized),
    )
    .sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
    );
}
