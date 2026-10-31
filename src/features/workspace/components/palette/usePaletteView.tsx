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
import { useCommands } from "@/shared/commands/CommandProvider";
import { matchSearchable, searchCommands } from "@/shared/commands/search";
import { readCommandUsage, usageWeight } from "@/shared/commands/usage";
import { appQueries } from "@apps/queries";
import { automationQueries } from "@automations/queries";
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
import { createSessionPane } from "@sessions/model/panes";
import { getRecentDirectories } from "@sessions/model/recentDirectories";
import { useSessionsActivity } from "@sessions/useSessionActivity";
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
  type PaletteNavigation,
} from "./items";
import {
  listItems,
  sectionByGroup,
  triageSessions,
  type PaletteItem,
  type PaletteSection,
  type PaletteState,
} from "./palette";

/** What the workspace supplies the palette: its sessions, and how to open what's chosen. */
export type PaletteData = {
  /** The listed (top-level) sessions. */
  sessions: readonly Session[];
  openSessionIds: readonly string[];
  navigation: PaletteNavigation;
};

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
  { sessions: listedSessions, openSessionIds, navigation }: PaletteData,
  { canAdd }: { canAdd: boolean },
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
    ...channelQueries.list(),
    select: (list) => list.channels,
  });
  const { data: appList } = useQuery(appQueries.list());
  const { data: automations = [] } = useQuery(automationQueries.list());
  const { mutateAsync: startSession } = useMutation(sessionMutations.startSession());
  const { mutateAsync: dispatchInboxTask } = useMutation(inboxMutations.dispatchTask());
  // Ranking holds still while the palette is open, rather than shifting as commands run.
  const [{ usage, openedAt }] = useState(() => ({
    usage: readCommandUsage(),
    openedAt: Date.now(),
  }));

  const isEnabled = (provider?: string) =>
    !provider || !workspace.disabledProviders.includes(provider);
  const sessions = listedSessions
    .filter((session) => isEnabled(session.provider?.id))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
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

  const openIds = new Set(openSessionIds);
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
      isOpen: openIds.has(session.id),
      pin: { isPinned: pinnedIds.has(session.id), toggle: () => togglePin(session.id) },
      navigation,
      canAdd,
    });

  const groups: Record<string, { icon: LucideIcon; items: readonly PaletteItem[] }> = {
    Sessions: { icon: MessageSquare, items: sessions.map(toSessionItem) },
    Channels: { icon: Hash, items: channels.map((channel) => channelItem(channel, navigation)) },
    Apps: {
      icon: AppWindow,
      items: (appList?.apps ?? []).map((app) =>
        appItem(
          app,
          appList?.definitions.find(({ id }) => id === app.definitionId),
          { navigation, canAdd },
        ),
      ),
    },
    Automations: {
      icon: Clock3,
      items: automations
        .filter((automation) => isEnabled(automation.model.provider))
        .map((automation) => automationItem(automation, navigation)),
    },
  };

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

  const launchOptions: PaletteItem[] = [
    {
      id: "palette.launch.model",
      title: "Change model…",
      detail: modelName,
      icon: Cpu,
      page: { kind: "model" },
    },
    {
      id: "palette.launch.directory",
      title: "Change directory…",
      detail: directoryName,
      icon: Folder,
      page: { kind: "directory" },
    },
  ];
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
              ...addToWorkspace(canAdd, async () => navigation.openRoot(await launchSession())),
              ...launchOptions,
            ],
            run: async () => navigation.selectRoot(await launchSession()),
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
        const matches = search([
          ...Object.values(groups).flatMap(({ items }) => items),
          ...commands,
          ...destinations,
        ]);
        return {
          sections: [
            ...sectionByGroup(matches, SEARCH_GROUP_LIMIT),
            ...sectionByGroup(listItems(launches)),
          ],
          placeholder: rootPlaceholder,
          empty: "No results",
        };
      }

      const triage = triageSessions(sessions, {
        activities,
        pinnedIds: workspace.pinnedIds,
        openIds: openSessionIds,
      });
      return {
        sections: [
          { heading: "Needs you", matches: listItems(triage.needsYou.map(toSessionItem)) },
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
      const files = directory ? filePaths.map((path) => fileItem(directory, path, navigation)) : [];
      const changeDirectory = launchOptions[1]!;
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
