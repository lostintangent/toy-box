import { describe, expect, test } from "bun:test";
import {
  initialPaletteState,
  reducePalette,
  resolveSelection,
  sectionByGroup,
  triageSessions,
  type PalettePageKind,
  type PaletteAction,
  type PaletteItem,
  type PaletteState,
} from "./palette";

const run = (...actions: PaletteAction[]) => actions.reduce(reducePalette, initialPaletteState);
const pages = (state: PaletteState) => state.stack.map(({ kind }) => kind);
const top = (state: PaletteState) => state.stack.at(-1)!;
const item = (id: string, fields: Partial<PaletteItem> = {}): PaletteItem => ({
  id,
  title: id,
  ...fields,
});
const sessionsPage: PalettePageKind = { kind: "group", group: "Sessions" };

describe("reducePalette", () => {
  test("typing selects the best match again", () => {
    const state = run({ type: "select", id: "b" }, { type: "type", query: "fix" });
    expect(top(state)).toEqual({ kind: "root", query: "fix", selected: undefined });
  });

  test("an opened page starts empty, and backing out restores the page beneath as it was", () => {
    const open: PaletteAction[] = [
      { type: "type", query: "ses" },
      { type: "select", id: "go.sessions" },
      { type: "open", page: sessionsPage },
    ];
    expect(top(run(...open))).toEqual({ ...sessionsPage, query: "" });
    expect(run(...open, { type: "type", query: "other" }, { type: "back" }).stack).toEqual([
      { kind: "root", query: "ses", selected: "go.sessions" },
    ]);
  });

  test("backing out to an index drops every page above it", () => {
    const state = run(
      { type: "open", page: sessionsPage },
      { type: "open", page: { kind: "files" } },
      { type: "open", page: { kind: "directory" } },
      { type: "back", index: 1 },
    );
    expect(pages(state)).toEqual(["root", "group"]);
  });

  test("never backs out of the root", () => {
    expect(run({ type: "back" })).toBe(initialPaletteState);
  });

  test("a page opened from an item's actions takes the actions' place", () => {
    const state = run(
      { type: "type", query: "fix the bug" },
      { type: "open", page: { kind: "actions", item: item("launch.session") } },
      { type: "open", page: { kind: "model" } },
    );
    expect(pages(state)).toEqual(["root", "model"]);
    expect(pages(reducePalette(state, { type: "back" }))).toEqual(["root"]);
    expect(top(reducePalette(state, { type: "back" })).query).toBe("fix the bug");
  });

  test("choosing an option for new work keeps the others and returns to the page beneath", () => {
    const state = run(
      { type: "type", query: "fix the bug" },
      { type: "open", page: { kind: "directory" } },
      { type: "choose", options: { directory: "/repo" } },
      { type: "open", page: { kind: "model" } },
      { type: "choose", options: { model: { name: "gpt", provider: "codex" } } },
    );
    expect(state.launch).toEqual({ directory: "/repo", model: { name: "gpt", provider: "codex" } });
    expect(state.stack).toEqual([{ kind: "root", query: "fix the bug" }]);
    expect(reducePalette(state, { type: "reset" })).toBe(initialPaletteState);
  });
});

describe("triageSessions", () => {
  const session = (id: string) => ({ id });
  const ids = (sessions: readonly { id: string }[]) => sessions.map(({ id }) => id);
  const none = { activities: {}, pinnedIds: [], openIds: [] };

  test("sessions waiting on you, or finished unseen, need you", () => {
    const sessions = [session("idle"), session("unread"), session("waiting")];
    const { needsYou, recent } = triageSessions(sessions, {
      ...none,
      activities: { waiting: { status: "waiting", since: 0 }, unread: { status: "unread" } },
    });
    expect(ids(needsYou)).toEqual(["unread", "waiting"]);
    expect(ids(recent)).toEqual(["idle"]);
  });

  test("an unread session that's already open doesn't need you", () => {
    const { needsYou } = triageSessions([session("unread")], {
      ...none,
      activities: { unread: { status: "unread" } },
      openIds: ["unread"],
    });
    expect(needsYou).toEqual([]);
  });

  test("running and background sessions are running", () => {
    const sessions = [session("background"), session("running")];
    const { running } = triageSessions(sessions, {
      ...none,
      activities: {
        running: { status: "running", since: 0 },
        background: { status: "background", since: 0 },
      },
    });
    expect(ids(running)).toEqual(["background", "running"]);
  });

  test("pinned sessions keep their pinned order, skipping ones that no longer exist", () => {
    const sessions = [session("a"), session("b"), session("c")];
    const { pinned, recent } = triageSessions(sessions, { ...none, pinnedIds: ["c", "gone", "a"] });
    expect(ids(pinned)).toEqual(["c", "a"]);
    expect(ids(recent)).toEqual(["b"]);
  });

  test("each session appears only in the first section that claims it", () => {
    const sessions = [session("a")];
    const { needsYou, pinned, recent } = triageSessions(sessions, {
      ...none,
      activities: { a: { status: "waiting", since: 0 } },
      pinnedIds: ["a"],
    });
    expect([needsYou, pinned, recent].map(ids)).toEqual([["a"], [], []]);
  });

  test("recent sessions exclude open ones and are capped", () => {
    const sessions = Array.from({ length: 8 }, (_, index) => session(`s${index}`));
    const { recent } = triageSessions(sessions, { ...none, openIds: ["s0"] });
    expect(ids(recent)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });
});

describe("sections", () => {
  const match = (id: string, group?: string) => ({
    item: item(id, { group }),
    score: 1,
    titleRanges: [],
  });

  test("sectionByGroup heads each group, in the order it first appears, up to the limit", () => {
    const sections = sectionByGroup(
      [match("a", "X"), match("b", "Y"), match("c", "X"), match("d"), match("e", "X")],
      2,
    );
    expect(
      sections.map(({ heading, matches }) => [heading, matches.map(({ item }) => item.id)]),
    ).toEqual([
      ["X", ["a", "c"]],
      ["Y", ["b"]],
      [undefined, ["d"]],
    ]);
  });

  test("resolveSelection keeps the chosen item while it's listed and enabled", () => {
    const sections = [
      { matches: [match("a"), { ...match("b"), item: item("b", { disabled: true }) }] },
      { matches: [match("c")] },
    ];
    expect(resolveSelection(sections, { selected: "c", query: "" })?.id).toBe("c");
    expect(resolveSelection(sections, { selected: "b", query: "" })?.id).toBe("a");
    expect(resolveSelection(sections, { selected: "gone", query: "" })?.id).toBe("a");
    expect(resolveSelection(sections, { query: "" })?.id).toBe("a");
    expect(resolveSelection([], { query: "" })).toBeUndefined();
  });

  test("resolveSelection opens a picker on its current choice, until something's typed", () => {
    const sections = [
      {
        matches: [
          { ...match("auto"), item: item("auto", { choose: {} }) },
          { ...match("opus"), item: item("opus", { choose: {}, checked: true }) },
        ],
      },
    ];
    expect(resolveSelection(sections, { query: "" })?.id).toBe("opus");
    expect(resolveSelection(sections, { query: "o" })?.id).toBe("auto");
  });
});
