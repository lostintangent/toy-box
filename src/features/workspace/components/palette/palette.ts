import type { ReactElement, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
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
export type PaletteItem = Omit<Command, "run" | "actions" | "icon"> & {
  /** A glyph, or an element that draws its own 16px picture. */
  icon?: LucideIcon | ReactElement;
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
export type PaletteSection = {
  heading?: string;
  matches: readonly PaletteMatch[];
  /** Selected only by moving to it, so Enter on opening can't act on what's open ("This …"). */
  skipsDefault?: boolean;
};

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

/** What's ready for you, at most TRIAGE_LIMIT of every kind together: what waits on you, then
 *  whatever else asks for you, each tier keeping the order it's given, so kinds needn't compare
 *  times. */
export function rankReadyForYou<C extends { attention?: string }>(candidates: readonly C[]) {
  const waiting = candidates.filter(({ attention }) => attention === "waiting");
  const rest = candidates.filter(({ attention }) => attention && attention !== "waiting");
  return [...waiting, ...rest].slice(0, TRIAGE_LIMIT);
}

/**
 * The sessions worth reaching for before searching, each in the first section that claims it:
 * those running, those pinned, and the most recent of the rest that aren't already open.
 * `sessions` are newest first, and exclude those already ready for you.
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

  return { running, pinned, recent };
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
 * typed, the current choice (so a picker opens on it); else the first outside `skipsDefault`.
 */
export function resolveSelection(
  sections: readonly PaletteSection[],
  { selected, query }: Pick<PalettePage, "selected" | "query">,
): PaletteItem | undefined {
  const enabled = (listed: readonly PaletteSection[]) =>
    listed.flatMap(({ matches }) => matches.flatMap(({ item }) => (item.disabled ? [] : [item])));
  const items = enabled(sections);
  return (
    items.find(({ id }) => id === selected) ??
    (query ? undefined : items.find(({ choose, checked }) => choose && checked)) ??
    enabled(sections.filter(({ skipsDefault }) => !skipsDefault))[0]
  );
}

/**
 * The pane the palette's "This …" acts on, as it opens: the one holding focus (`heldId`), which must
 * be one of `panes`, not, say, a Hyper window's; else the surface's focused pane (the grid's
 * maximized one, or the pager's page), the phone pager's first page, or the grid's only pane.
 */
export function resolveCurrentPane<Pane extends { id: string }>(
  panes: readonly Pane[],
  { heldId, focusedId, isMobile }: { heldId?: string; focusedId: string | null; isMobile: boolean },
): Pane | undefined {
  const find = (id: string | null) => panes.find((pane) => pane.id === id);
  if (heldId !== undefined) return find(heldId);
  return find(focusedId) ?? (isMobile || panes.length === 1 ? panes[0] : undefined);
}
