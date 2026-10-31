import type { ReactNode } from "react";
import type { Command } from "@/shared/commands/command";
import type { SearchMatch } from "@/shared/commands/search";
import type { ModelConfiguration } from "@providers/model";
import type { SessionLocation } from "@sessions/model";
import type { SessionsActivity } from "@sessions/model/activity";

// The palette is a stack of pages over one search field: the workspace at its root, and pages it
// drills into (a list of one kind of thing, an item's actions, or an option for new work). Each
// page keeps its own query and selection, so backing out returns to them as they were.

/** What a page lists. */
export type PalettePageKind =
  | { kind: "root" }
  /** Every item of one group, e.g. all sessions. */
  | { kind: "group"; group: string }
  | { kind: "files" }
  /** What can be done to an item, as a menu that choosing from closes. */
  | { kind: "actions"; item: PaletteItem }
  | { kind: "model" }
  | { kind: "directory" };

/** A page as it's open: its query, and the ID of its selected item (or else its first). */
export type PalettePage = PalettePageKind & { query: string; selected?: string };

/** A row of the palette: a command, or a link to a page. */
export type PaletteItem = Omit<Command, "run" | "actions"> & {
  run?: Command["run"];
  page?: PalettePageKind;
  /** An option for new work, which choosing sets and returns to the page beneath. */
  choose?: SessionLaunchOptions;
  /** What Enter does to it, e.g. "Open" or "Start". */
  verb?: string;
  /** Live trailing status, e.g. a running timer. */
  accessory?: ReactNode;
  /** A larger rendering of the subject, shown beside the row once it's lingered on. */
  preview?: () => ReactNode;
  actions?: readonly PaletteItem[];
};

export type PaletteMatch = SearchMatch<PaletteItem>;
export type PaletteSection = { heading?: string; matches: readonly PaletteMatch[] };

/**
 * How new work starts here (and where files are found), unless chosen: with the default model, in
 * the latest directory, and in a worktree as the workspace's setting says.
 */
export type SessionLaunchOptions = { model?: ModelConfiguration } & SessionLocation;

export type PaletteState = {
  stack: readonly [PalettePage, ...PalettePage[]];
  launch: SessionLaunchOptions;
};

export type PaletteAction =
  | { type: "type"; query: string }
  | { type: "select"; id: string }
  | { type: "open"; page: PalettePageKind }
  /** Returns to the page at `index` in the stack, by default the one beneath. */
  | { type: "back"; index?: number }
  | { type: "choose"; options: SessionLaunchOptions }
  | { type: "reset" };

export const initialPaletteState: PaletteState = {
  stack: [{ kind: "root", query: "" }],
  launch: {},
};

export function reducePalette(state: PaletteState, action: PaletteAction): PaletteState {
  const { stack } = state;
  const top = stack.at(-1)!;

  switch (action.type) {
    case "type":
      // A new query selects its best match again.
      return withTop(state, { ...top, query: action.query, selected: undefined });
    case "select":
      return withTop(state, { ...top, selected: action.id });
    case "open": {
      // An item's actions are a menu, so the page one of them opens takes the menu's place.
      const [root, ...rest] =
        top.kind === "actions" && stack.length > 1 ? stack.slice(0, -1) : stack;
      return { ...state, stack: [root!, ...rest, { ...action.page, query: "" }] };
    }
    case "back": {
      const index = Math.max(0, action.index ?? stack.length - 2);
      if (index >= stack.length - 1) return state;
      const [root, ...rest] = stack.slice(0, index + 1);
      return { ...state, stack: [root!, ...rest] };
    }
    case "choose":
      return reducePalette(
        { ...state, launch: { ...state.launch, ...action.options } },
        { type: "back" },
      );
    case "reset":
      return initialPaletteState;
  }
}

function withTop(state: PaletteState, page: PalettePage): PaletteState {
  const [root, ...rest] = state.stack;
  return { ...state, stack: rest.length ? [root, ...rest.slice(0, -1), page] : [page] };
}

const TRIAGE_LIMIT = 5;

/**
 * The sessions worth reaching for before searching, each in the first section that claims it:
 * those that need you (waiting on you, or finished unseen), those running, those pinned, and the
 * most recent of the rest that aren't already open. `sessions` are newest first.
 */
export function triageSessions<S extends { id: string }>(
  sessions: readonly S[],
  {
    activities,
    pinnedIds,
    openIds,
  }: {
    activities: Readonly<SessionsActivity>;
    pinnedIds: readonly string[];
    openIds: readonly string[];
  },
) {
  const open = new Set(openIds);
  const claimed = new Set<string>();
  const claim = (candidates: readonly S[], limit = Infinity) => {
    const taken = candidates.filter(({ id }) => !claimed.has(id)).slice(0, limit);
    for (const { id } of taken) claimed.add(id);
    return taken;
  };
  const status = (session: S) => activities[session.id]?.status;

  const needsYou = claim(
    sessions.filter(
      (session) =>
        status(session) === "waiting" || (status(session) === "unread" && !open.has(session.id)),
    ),
    TRIAGE_LIMIT,
  );
  const running = claim(
    sessions.filter((session) => status(session) === "running" || status(session) === "background"),
    TRIAGE_LIMIT,
  );
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const pinned = claim(pinnedIds.flatMap((id) => sessionsById.get(id) ?? []));
  const recent = claim(
    sessions.filter(({ id }) => !open.has(id)),
    TRIAGE_LIMIT,
  );

  return { needsYou, running, pinned, recent };
}

/**
 * Matches as sections headed by their group, in the order each group first appears, each keeping
 * at most `limit` of its matches.
 */
export function sectionByGroup(
  matches: readonly PaletteMatch[],
  limit = Infinity,
): PaletteSection[] {
  const sections = new Map<string | undefined, PaletteMatch[]>();
  for (const match of matches) {
    const section = sections.get(match.item.group);
    if (!section) sections.set(match.item.group, [match]);
    else if (section.length < limit) section.push(match);
  }
  return [...sections].map(([heading, matches]) => ({ heading, matches }));
}

/** Items listed as they are, without search. */
export const listItems = (items: readonly PaletteItem[]): PaletteMatch[] =>
  items.map((item) => ({ item, score: 0, titleRanges: [] }));

/**
 * The page's selected item: the one chosen, while it's listed and enabled; else, before anything's
 * typed, the current choice (so a picker opens on it); else the first.
 */
export function resolveSelection(
  sections: readonly PaletteSection[],
  { selected, query }: Pick<PalettePage, "selected" | "query">,
): PaletteItem | undefined {
  const items = sections.flatMap(({ matches }) => matches.map(({ item }) => item));
  const enabled = items.filter((item) => !item.disabled);
  return (
    enabled.find(({ id }) => id === selected) ??
    (query ? undefined : enabled.find(({ choose, checked }) => choose && checked)) ??
    enabled[0]
  );
}
