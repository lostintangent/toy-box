import type { AppDefinition, AppInstance, AppShare } from "@apps/model";
import type { Automation } from "@automations/model";
import type { CustomEditorKind } from "@files/model";
import type { InboxEntry } from "@inbox/model";
import type { SessionUpdate } from "@sessions/model";
import type { WorkerEvent } from "@workers/model";
import type { Channel } from "@channels/model";
import type { Settings } from "./config/settings";
import type { WorkspaceAction } from "./state/actions";

/** Shared updates broadcast from the server to every connected workspace. */
export type WorkspaceEvent =
  | WorkspaceAction
  | WorkerEvent
  | { type: "channel.upserted"; channel: Channel }
  | { type: "channel.deleted"; channelId: string }
  | { type: "channel.members.changed" }
  | {
      type: "settings.changed";
      settings: Settings;
    }
  | {
      type: "session.upserted";
      session: SessionUpdate;
    }
  | SimpleSessionUpdateEvents<"deleted" | "running" | "waiting" | "idle" | "unread" | "touched">
  | {
      type: "inbox.entry.upserted";
      entry: InboxEntry;
    }
  | {
      type: "inbox.entry.deleted";
      entryId: string;
    }
  | {
      type: "editor.registered";
      kind: CustomEditorKind;
    }
  | {
      type: "app.registered";
      definition: AppDefinition;
    }
  | {
      type: "app.unregistered";
      definitionId: string;
    }
  | {
      type: "app.upserted";
      app: AppInstance;
    }
  | {
      type: "app.deleted";
      appId: string;
    }
  | {
      type: "app.share.created";
      share: AppShare;
    }
  | {
      type: "app.share.deleted";
      shareId: string;
    }
  | {
      type: "automation.upserted";
      automation: Automation;
    }
  | {
      type: "automation.deleted";
      automationId: string;
    };

type SimpleSessionUpdateEvents<EventName extends string> = EventName extends string
  ? {
      type: `session.${EventName}`;
      sessionId: string;
    }
  : never;
