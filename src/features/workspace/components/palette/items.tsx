import type { ReactNode } from "react";
import {
  AppWindow,
  Clock3,
  File,
  FileText,
  Folder,
  FolderGit2,
  Hash,
  MessageSquare,
  Plus,
  Shapes,
} from "lucide-react";
import { ALTERNATE_SHORTCUT, type Command } from "@/shared/commands/command";
import { SidebarStatusMark, type SidebarStatus } from "@/shared/sidebar/SidebarStatus";
import { RelativeTime } from "@/shared/ui/relative-time";
import { appCommands } from "@apps/commands";
import { APP_ICONS } from "@apps/components/runtime/icons";
import { createAppPane, type AppDefinition, type AppInstance } from "@apps/model";
import { automationCommands } from "@automations/commands";
import type { Automation } from "@automations/model";
import { channelCommands } from "@channels/commands";
import { channelAttention, createChannelPane, type Channel } from "@channels/model";
import { machineFile } from "@files/model";
import { createEditorPane } from "@files/model/panes";
import { getPathBasename, getPathDirname, toRelativePath } from "@files/model/paths";
import { modelCatalogKey, type ModelConfiguration, type ModelInfo } from "@providers/model";
import { sessionCommands } from "@sessions/commands";
import { resolveSessionLocation } from "@sessions/components/location/locationDisplay";
import { SessionPreviewPane } from "@sessions/components/SessionPreview";
import { RunningTime } from "@sessions/components/sidebar/SessionListItem";
import type { Session } from "@sessions/model";
import { getSessionLabel } from "@sessions/model/label";
import { createSessionPane } from "@sessions/model/panes";
import type { RecentDirectory } from "@sessions/model/recentDirectories";
import type { WorkspacePane } from "@workspace/model/panes";
import { sessionAttention, type SessionActivity } from "@sessions/model/activity";
import type { PaletteItem } from "./palette";

// How each kind of thing in the workspace reads as a palette row: what it's called, what
// identifies it (the ID of the pane it opens, so "This …" finds the current pane's row), its live
// status, and what Enter, Mod+Enter and its actions do to it.

/** Where the palette opens what's chosen: the workspace's root verbs, as the sidebar uses them. */
export type PaletteNavigation = {
  /** Shows a pane in place of the workspace's others. */
  selectRoot: (pane: WorkspacePane) => void;
  /** Opens a pane beside the workspace's others. */
  openRoot: (pane: WorkspacePane) => Promise<void>;
};

/** Only a desktop's grid has room to add a pane beside the others. */
export const addToWorkspace = (canAdd: boolean, add: Command["run"]): PaletteItem[] =>
  canAdd
    ? [
        {
          id: "workspace.add",
          title: "Add to workspace",
          icon: Plus,
          shortcut: ALTERNATE_SHORTCUT,
          run: add,
        },
      ]
    : [];

export function sessionItem(
  session: Session,
  {
    activity,
    isOpen,
    pin,
    navigation,
    canAdd,
  }: {
    activity?: SessionActivity;
    isOpen: boolean;
    /** A child session's row has no Pin, as in the sidebar. */
    pin?: { isPinned: boolean; toggle: () => void };
    navigation: PaletteNavigation;
    canAdd: boolean;
  },
): PaletteItem {
  const { directory, repository, gitRoot } = session.context ?? {};
  const pane = createSessionPane(session.id);
  return {
    id: pane.id,
    title: getSessionLabel(session),
    group: "Sessions",
    detail: resolveSessionLocation({ repository, gitRoot, cwd: directory })?.label,
    icon: session.artifactPath
      ? session.artifactPath.toLowerCase().endsWith(".md")
        ? FileText
        : Shapes
      : MessageSquare,
    accessory: (
      <SessionAccessory activity={activity} isOpen={isOpen}>
        <RelativeTime date={session.updatedAt} />
      </SessionAccessory>
    ),
    preview: () => <SessionPreviewPane sessionId={session.id} />,
    actions: [
      ...addToWorkspace(canAdd, () => navigation.openRoot(pane)),
      ...sessionCommands(session, pin),
    ],
    verb: "Open",
    run: () => navigation.selectRoot(pane),
  };
}

/** What a session is doing, or else what its row shows at rest. */
function SessionAccessory({
  activity,
  isOpen,
  children,
}: {
  activity?: SessionActivity;
  isOpen: boolean;
  children: ReactNode;
}) {
  const attention = sessionAttention(activity?.status, isOpen);
  if (attention === "waiting") return <Status kind="waiting">Waiting for you</Status>;
  if (activity?.status === "running") {
    return (
      <Status kind="running">
        <RunningTime since={activity.since} />
      </Status>
    );
  }
  if (activity?.status === "background") return <Status kind="background">Background tasks</Status>;

  return attention === "unread" ? <Status kind="unread">{children}</Status> : children;
}

function Status({ kind, children }: { kind: SidebarStatus["kind"]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex size-4 items-center justify-center">
        <SidebarStatusMark kind={kind} />
      </span>
      {children}
    </span>
  );
}

export function channelItem(
  channel: Channel,
  {
    isOpen,
    navigation,
    canAdd,
  }: { isOpen: boolean; navigation: PaletteNavigation; canAdd: boolean },
): PaletteItem {
  const pane = createChannelPane(channel.id);
  const attention = channelAttention(channel, isOpen);
  const updated = <RelativeTime date={channel.updatedAt} />;
  return {
    id: pane.id,
    title: channel.name,
    group: "Channels",
    icon: Hash,
    accessory: attention ? (
      <Status kind={attention}>{attention === "waiting" ? "Waiting for you" : updated}</Status>
    ) : (
      updated
    ),
    actions: [
      ...addToWorkspace(canAdd, () => navigation.openRoot(pane)),
      ...channelCommands(channel),
    ],
    verb: "Open",
    run: () => navigation.selectRoot(pane),
  };
}

export function appItem(
  app: AppInstance,
  definition: AppDefinition | undefined,
  { navigation, canAdd }: { navigation: PaletteNavigation; canAdd: boolean },
): PaletteItem {
  const pane = createAppPane(app.id);
  return {
    id: pane.id,
    title: app.title,
    group: "Apps",
    detail: definition && definition.title !== app.title ? definition.title : undefined,
    icon: (definition?.icon && APP_ICONS[definition.icon]) || AppWindow,
    actions: [...addToWorkspace(canAdd, () => navigation.openRoot(pane)), ...appCommands(app)],
    verb: "Open",
    run: () => navigation.selectRoot(pane),
  };
}

export function automationItem(
  automation: Automation,
  {
    activity,
    isOpen,
    navigation,
    canAdd,
    run,
  }: {
    activity?: SessionActivity;
    isOpen: boolean;
    navigation: PaletteNavigation;
    canAdd: boolean;
    run: Parameters<typeof automationCommands>[1]["run"];
  },
): PaletteItem {
  const pane = createSessionPane(automation.id);
  return {
    id: pane.id,
    title: automation.title,
    group: "Automations",
    detail: automation.cwd ? resolveSessionLocation({ cwd: automation.cwd })?.label : undefined,
    icon: Clock3,
    accessory: (
      <SessionAccessory activity={activity} isOpen={isOpen}>
        <span>
          Runs <RelativeTime date={automation.nextRunAt} />
        </span>
      </SessionAccessory>
    ),
    actions: [
      ...addToWorkspace(canAdd, () => navigation.openRoot(pane)),
      ...automationCommands(automation, { run, isRunning: activity?.status === "running" }),
    ],
    verb: "Open",
    run: () => navigation.selectRoot(pane),
  };
}

/** A file found beneath `directory`, by its path relative to it. */
export function fileItem(
  directory: string,
  path: string,
  navigation: PaletteNavigation,
): PaletteItem {
  const dirname = getPathDirname(path);
  return {
    id: `file:${path}`,
    title: getPathBasename(path),
    detail: dirname === "." ? undefined : dirname,
    icon: File,
    verb: "Open",
    run: () =>
      navigation.openRoot(
        createEditorPane(machineFile(`${directory.replace(/[\\/]+$/, "")}/${path}`)),
      ),
  };
}

export function modelItem(
  model: ModelInfo,
  { selected, configuration }: { selected: boolean; configuration: ModelConfiguration },
): PaletteItem {
  return {
    id: `model:${modelCatalogKey(model)}`,
    title: model.name,
    group: model.providerName ?? model.provider,
    checked: selected,
    choose: { model: configuration },
    verb: "Choose",
  };
}

export function directoryItem(directory: RecentDirectory, selected: boolean): PaletteItem {
  const location = resolveSessionLocation(directory);
  return {
    id: `directory:${directory.cwd}`,
    title: location?.label ?? directory.cwd,
    detail: toRelativePath(directory.cwd),
    icon: location?.kind === "repository" ? FolderGit2 : Folder,
    checked: selected,
    choose: { directory: directory.cwd },
    verb: "Choose",
  };
}
