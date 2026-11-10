import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer/debouncer";
import {
  AppWindow,
  Clock3,
  Cpu,
  Folder,
  FolderSearch,
  GitFork,
  Hash,
  Inbox,
  MessageCirclePlus,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { getAlternateAction } from "@/shared/commands/command";
import { useCommands } from "@/shared/commands/CommandProvider";
import { matchSearchable, searchCommands } from "@/shared/commands/search";
import { readCommandUsage, usageWeight } from "@/shared/commands/usage";
import { appQueries } from "@apps/queries";
import type { Automation } from "@automations/model";
import { automationMutations } from "@automations/mutations";
import { automationQueries } from "@automations/queries";
import { channelAttention, createChannelPane, type Channel } from "@channels/model";
import { channelQueries } from "@channels/queries";
import { fileQueries } from "@files/queries";
import { inboxMutations } from "@inbox/mutations";
import {
  modelCatalogKey,
  modelConfigurationKey,
  resolveModelConfigurationForModel,
} from "@providers/model";
import { useModels } from "@providers/useModels";
import { resolveSessionLocation } from "@sessions/components/location/locationDisplay";
import { sessionMutations } from "@sessions/mutations";
import type { Session } from "@sessions/model";
import { sessionAttention } from "@sessions/model/activity";
import { createSessionPane } from "@sessions/model/panes";
import { getRecentDirectories } from "@sessions/model/recentDirectories";
import { selectSessionChildren, sessionQueries } from "@sessions/queries";
import { useSessionsActivity } from "@sessions/useSessionActivity";
import { useWorkspaceRoots } from "@workspace/hooks/layout/roots";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import {
  addToWorkspace,
  appItem,
  automationItem,
  channelItem,
  directoryItem,
  fileItem,
  modelItem,
  sessionItem,
} from "./items";
import {
  listItems,
  rankReadyForYou,
  resolveCurrentPane,
  sectionByGroup,
  triageSessions,
  type PaletteItem,
  type PaletteSection,
  type PaletteState,
} from "./palette";

/** What the workspace supplies the palette: its listed (top-level) sessions. */
export type PaletteData = { sessions: readonly Session[] };

/** The open page as it's shown: its sections, and what its field and an empty list say. */
export type PaletteView = { sections: PaletteSection[]; placeholder: string; empty: string };

/** A search lists no more than this of any one group, so a broad query can't bury the others. */
const SEARCH_GROUP_LIMIT = 8;
/** A page lists no more than this, keeping long histories responsive. */
const PAGE_LIMIT = 100;
/** How far frequent use lifts a match, relative to where its terms occur (see `matchSearchable`). */
const USAGE_BOOST = 40;
/**
 * How far commands and places lift above content. They're few and named to be found, but lead
 * with a verb ("Open Inbox"), so a content title that starts with the term would otherwise outrank
 * them. It's less than an exact title or frequent use.
 */
const COMMAND_BOOST = 25;
const FILE_SEARCH_DEBOUNCE_MS = 150;

export function usePaletteView(
  { stack, launch }: PaletteState,
  { sessions: listedSessions }: PaletteData,
  { isMobile }: { isMobile: boolean },
): PaletteView {
  const page = stack.at(-1)!;
  const prompt = page.query.trim();

  const providedCommands = useCommands();
  const activities = useSessionsActivity((activities) => activities);
  const workspace = useWorkspaceSelector(({ settings }) => ({
    pinnedIds: settings.pinnedSessionIds,
    disabledProviders: settings.disabledProviders,
    useWorktree: settings.useWorktree,
  }));
  const updateSetting = useUpdateWorkspaceSetting();
  const { models, hasModels, defaultModel } = useModels();
  const { data: channels = [] } = useQuery({
    ...channelQueries.list,
    select: (list) => list.channels,
  });
  const { data: appList } = useQuery(appQueries.list);
  const { data: automations = [] } = useQuery(automationQueries.list);
  const { data: childrenByParent = {} } = useQuery({
    ...sessionQueries.state,
    select: selectSessionChildren,
  });
  const { mutateAsync: startSession } = useMutation(sessionMutations.startSession());
  const { mutateAsync: dispatchInboxTask } = useMutation(inboxMutations.dispatchTask());
  const { mutate: runAutomation } = useMutation(automationMutations.run());
  const { panes, focusedPaneAtom } = useWorkspaceSurface();
  const roots = useWorkspaceRoots();
  // Ranking and the current pane hold still while the palette is open, rather than shifting as
  // commands run. This runs before the palette takes focus, so it still sees the pane that held it.
  const [{ usage, openedAt, currentPane }] = useState(() => ({
    usage: readCommandUsage(),
    openedAt: Date.now(),
    currentPane: resolveCurrentPane(panes, {
      heldId: document.activeElement?.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId,
      focusedId: focusedPaneAtom.get(),
      isMobile,
    }),
  }));
  const canAdd = !isMobile;

  const isEnabled = (provider?: string) =>
    !provider || !workspace.disabledProviders.includes(provider);
  const sessions = listedSessions
    .filter((session) => isEnabled(session.provider?.id))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  const enabledAutomations = automations.filter((automation) =>
    isEnabled(automation.model.provider),
  );
  const recentDirectories = getRecentDirectories(sessions);

  const model = launch.model ?? defaultModel ?? undefined;
  const modelKey = model && modelConfigurationKey(model);
  const modelName =
    model && (models.find((info) => modelCatalogKey(info) === modelKey)?.name ?? model.name);
  const directory = launch.directory ?? recentDirectories[0]?.cwd;
  const useWorktree = launch.useWorktree ?? workspace.useWorktree;
  const directoryName =
    directory &&
    resolveSessionLocation(
      recentDirectories.find(({ cwd }) => cwd === directory) ?? { cwd: directory },
    )?.label;

  const [fileQuery] = useDebouncedValue(page.kind === "files" ? prompt : "", {
    wait: FILE_SEARCH_DEBOUNCE_MS,
  });
  const { data: filePaths = [], isFetching: isSearchingFiles } = useQuery({
    ...fileQueries.search(directory ?? "", fileQuery),
    enabled: page.kind === "files" && directory !== undefined,
    // A changed search shows the last one's results meanwhile, unless they're another directory's.
    placeholderData: (previous, query) => (query?.queryKey[2] === directory ? previous : undefined),
  });

  const pinnedIds = new Set(workspace.pinnedIds);
  const togglePin = (sessionId: string) =>
    updateSetting(
      "pinnedSessionIds",
      pinnedIds.has(sessionId)
        ? workspace.pinnedIds.filter((id) => id !== sessionId)
        : [...workspace.pinnedIds, sessionId],
    );
  const toSessionItem = (session: Session) =>
    sessionItem(session, {
      activity: activities[session.id],
      pin: { isPinned: pinnedIds.has(session.id), toggle: () => togglePin(session.id) },
      roots,
      canAdd,
    });
  const toChannelItem = (channel: Omit<Channel, "tasks">) =>
    channelItem(channel, { roots, canAdd });
  const toAutomationItem = (automation: Automation) =>
    automationItem(automation, {
      activity: activities[automation.id],
      roots,
      canAdd,
      run: runAutomation,
    });

  // Each group names what one of its rows is, which heads "This …" when the current pane has one.
  const groups: Record<string, { icon: LucideIcon; noun: string; items: PaletteItem[] }> = {
    Sessions: { icon: MessageSquare, noun: "session", items: sessions.map(toSessionItem) },
    Channels: { icon: Hash, noun: "channel", items: channels.map(toChannelItem) },
    Apps: {
      icon: AppWindow,
      noun: "app",
      items: (appList?.apps ?? []).map((app) =>
        appItem(
          app,
          appList?.definitions.find(({ id }) => id === app.definitionId),
          { roots, canAdd },
        ),
      ),
    },
    Automations: {
      icon: Clock3,
      noun: "automation",
      items: enabledAutomations.map(toAutomationItem),
    },
  };

  // "This …" is what can be done in place to the current pane, or to the session it belongs to.
  // A child session isn't listed, but its pane offers what its sidebar row does: all but Pin.
  const rows = Object.values(groups).flatMap(({ items }) => items);
  const subject =
    currentPane?.sessionId === undefined ? currentPane : createSessionPane(currentPane.sessionId);
  const child = Object.values(childrenByParent)
    .flat()
    .find(({ id }) => id === currentPane?.sessionId);
  const subjectRow =
    subject &&
    (rows.find(({ id }) => id === subject.id) ?? (child && sessionItem(child, { roots, canAdd })));
  const currentActions: PaletteItem[] = subjectRow
    ? (subjectRow.actions ?? [])
        .filter((action) => action !== getAlternateAction(subjectRow))
        .map((action) => ({ ...action, group: `This ${groups[subjectRow.group!].noun}` }))
    : [];

  // The palette's own command would only close it.
  const commands = providedCommands.filter(({ id }) => id !== "workspace.search");

  const destinations: PaletteItem[] = [
    ...Object.entries(groups).flatMap(([group, { icon, items }]) =>
      items.length > 0
        ? [
            {
              id: `palette.${group.toLowerCase()}`,
              title: group,
              group: "Go to",
              icon,
              accessory: items.length,
              page: { kind: "group", group } as const,
            },
          ]
        : [],
    ),
    ...(directory
      ? [
          {
            id: "palette.files",
            title: "Files",
            group: "Go to",
            detail: directoryName,
            icon: FolderSearch,
            page: { kind: "files" } as const,
          },
        ]
      : []),
  ];

  const changeModel: PaletteItem = {
    id: "palette.launch.model",
    title: "Change model…",
    detail: modelName,
    icon: Cpu,
    page: { kind: "model" },
  };
  const changeDirectory: PaletteItem = {
    id: "palette.launch.directory",
    title: "Change directory…",
    detail: directoryName,
    icon: Folder,
    page: { kind: "directory" },
  };
  const launchOptions = [changeModel, changeDirectory];
  const launchDetail = [modelName, directoryName, directory && useWorktree && "worktree"]
    .filter(Boolean)
    .join(" · ");
  const sessionLaunch = {
    message: { content: prompt, model },
    location: { directory, useWorktree },
  };
  // The session starts headlessly, as from the Inbox, and its pane then attaches to the running turn.
  const launchSession = async () =>
    createSessionPane((await startSession(sessionLaunch)).sessionId);

  // A query that names nothing can still start work, with the query as its prompt.
  const launches: PaletteItem[] =
    hasModels && prompt
      ? [
          {
            id: "palette.launch.session",
            title: `New session: ${prompt}`,
            group: "Start",
            detail: launchDetail,
            icon: MessageCirclePlus,
            verb: "Start",
            actions: [
              ...addToWorkspace(canAdd, async () => roots.openRoot(await launchSession())),
              ...launchOptions,
            ],
            run: async () => roots.selectRoot(await launchSession()),
          },
          {
            id: "palette.launch.inbox",
            title: `Run in Inbox: ${prompt}`,
            group: "Start",
            detail: launchDetail,
            icon: Inbox,
            verb: "Run",
            actions: launchOptions,
            run: () => dispatchInboxTask(sessionLaunch),
          },
        ]
      : [];

  const search = (items: readonly PaletteItem[]) =>
    searchCommands(
      items,
      page.query,
      (item) =>
        usageWeight(usage, item.id, openedAt) * USAGE_BOOST +
        (Object.hasOwn(groups, item.group ?? "") ? 0 : COMMAND_BOOST),
    );

  const rootPlaceholder = hasModels ? "Search, or describe new work…" : "Search…";

  switch (page.kind) {
    case "root": {
      if (prompt) {
        const matches = search([...rows, ...currentActions, ...commands, ...destinations]);
        return {
          sections: [
            ...sectionByGroup(matches, SEARCH_GROUP_LIMIT),
            ...sectionByGroup(listItems(launches)),
          ],
          placeholder: rootPlaceholder,
          empty: "No results",
        };
      }

      // Within each tier, sessions lead, then channels, then automations.
      const sessionAttentionOf = ({ id }: { id: string }) =>
        sessionAttention(activities[id]?.status, roots.isOpen(createSessionPane(id)));
      const readyForYou = rankReadyForYou([
        ...sessions.map((session) => ({
          attention: sessionAttentionOf(session),
          item: () => toSessionItem(session),
        })),
        ...channels.map((channel) => {
          const attention = channelAttention(channel, roots.isOpen(createChannelPane(channel.id)));
          // A channel's unread messages alone don't make it ready for you.
          return {
            attention: attention === "unread" ? undefined : attention,
            item: () => toChannelItem(channel),
          };
        }),
        ...enabledAutomations.map((automation) => ({
          attention: sessionAttentionOf(automation),
          item: () => toAutomationItem(automation),
        })),
      ]).map(({ item }) => item());
      // Sessions past the cap fall through to the sections below.
      const listedIds = new Set(readyForYou.map(({ id }) => id));
      const triage = triageSessions(
        sessions.filter(({ id }) => !listedIds.has(createSessionPane(id).id)),
        {
          activities,
          pinnedIds: workspace.pinnedIds,
          openIds: sessions.flatMap(({ id }) => (roots.isOpen(createSessionPane(id)) ? [id] : [])),
        },
      );
      return {
        sections: [
          {
            heading: currentActions[0]?.group,
            matches: listItems(currentActions),
            skipsDefault: true,
          },
          { heading: "Ready for you", matches: listItems(readyForYou) },
          { heading: "Running", matches: listItems(triage.running.map(toSessionItem)) },
          { heading: "Pinned", matches: listItems(triage.pinned.map(toSessionItem)) },
          { heading: "Recent", matches: listItems(triage.recent.map(toSessionItem)) },
          ...sectionByGroup(listItems(commands)),
          { heading: "Go to", matches: listItems(destinations) },
        ].filter(({ matches }) => matches.length > 0),
        placeholder: rootPlaceholder,
        empty: "Nothing here yet",
      };
    }

    case "group":
      return {
        sections: [{ matches: search(groups[page.group]?.items ?? []).slice(0, PAGE_LIMIT) }],
        placeholder: `Search ${page.group.toLowerCase()}…`,
        empty: prompt ? "No results" : `No ${page.group.toLowerCase()}`,
      };

    case "actions":
      return {
        sections: [{ matches: search(page.item.actions ?? []) }],
        placeholder: "Search actions…",
        empty: "No results",
      };

    case "files": {
      const files = directory ? filePaths.map((path) => fileItem(directory, path, roots)) : [];
      return {
        sections: [
          {
            matches: files.map((item) => ({
              item,
              score: 0,
              titleRanges: matchSearchable(item, prompt)?.titleRanges ?? [],
            })),
          },
          { matches: matchSearchable(changeDirectory, prompt) ? listItems([changeDirectory]) : [] },
        ].filter(({ matches }) => matches.length > 0),
        placeholder: directoryName ? `Search files in ${directoryName}…` : "Search files…",
        empty: !directory ? "No recent directory" : isSearchingFiles ? "Searching…" : "No results",
      };
    }

    case "model": {
      const defaultKey = defaultModel && modelConfigurationKey(defaultModel);
      const items = models.map((info) =>
        modelItem(info, {
          selected: modelCatalogKey(info) === modelKey,
          // The default keeps its configured effort; another model starts from its own.
          configuration:
            defaultModel && modelCatalogKey(info) === defaultKey
              ? defaultModel
              : resolveModelConfigurationForModel(info, {
                  name: info.id,
                  provider: info.provider,
                }),
        }),
      );
      return {
        sections: sectionByGroup(search(items)),
        placeholder: "Search models…",
        empty: "No results",
      };
    }

    case "directory": {
      const items = recentDirectories.map((recent) =>
        directoryItem(recent, recent.cwd === directory),
      );
      // As in the composer, whether new work gets its own worktree is chosen with its directory.
      const worktree: PaletteItem = {
        id: "palette.launch.worktree",
        title: "Use a worktree",
        icon: GitFork,
        checked: useWorktree,
        choose: { useWorktree: !useWorktree },
        verb: "Toggle",
      };
      return {
        sections: [{ matches: search(directory ? [...items, worktree] : items) }],
        placeholder: "Search directories…",
        empty: prompt ? "No results" : "No recent directories",
      };
    }
  }
}
