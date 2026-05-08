import type { Attachment } from "@/types";
import {
  applySessionEvent,
  createInitialSession,
  type Session,
} from "@/lib/session/sessionReducer";
import { readAttachment } from "../state/attachments";
import { readPath } from "./extractors";
import {
  projectSessionEventsFromSdkHistory,
  type HistoryAdaptOptions,
  type SdkSessionEvent,
} from "./projector";

async function readHistoryAttachments(attachments: unknown): Promise<Attachment[] | undefined> {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;

  return Promise.all(
    attachments.map((attachment) =>
      readAttachment(attachment as { displayName?: string; path?: string; filePath?: string }),
    ),
  );
}

export async function initializeSessionStateFromSdkHistory(
  events: SdkSessionEvent[],
  options?: HistoryAdaptOptions,
): Promise<Session> {
  const state = createInitialSession();

  for await (const event of projectSessionEventsFromSdkHistory(events, {
    ...options,
    resolveAttachments:
      options?.resolveAttachments ??
      ((event) => {
        return readHistoryAttachments(readPath(event.data, "attachments"));
      }),
  })) {
    applySessionEvent(state, event);
  }

  return state;
}
