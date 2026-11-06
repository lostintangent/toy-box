import { describe, expect, test } from "bun:test";
import type { ChannelConversationMessage, ChannelMessage } from "@channels/model";
import {
  messageRowIndex,
  transcriptDayLabel,
  transcriptRows,
  type AgentRunEntry,
  type TranscriptRow,
} from "./transcriptRows";

// Local wall-clock times keep day boundaries independent of the test machine's time zone.
function at(day: number, hour: number, minute: number): string {
  return new Date(2026, 8, day, hour, minute).toISOString();
}

function agentPost(
  sequence: number,
  agentId: string,
  timestamp = at(26, 10, sequence),
  content = `Update ${sequence}`,
): ChannelConversationMessage {
  const sender = { type: "agent", agentId } as const;
  return { id: `${sequence}`, sequence, timestamp, sender, content };
}

function userPost(sequence: number, timestamp = at(26, 10, sequence)): ChannelMessage {
  return { id: `${sequence}`, sequence, timestamp, sender: { type: "user" }, content: "Thanks" };
}

function event(
  sequence: number,
  content: Extract<ChannelMessage, { sender: { type: "system" } }>["content"],
): ChannelMessage {
  return {
    id: `${sequence}`,
    sequence,
    timestamp: at(26, 9, 0),
    sender: { type: "system" },
    content,
  };
}

const lead = { id: "lead", name: "Lead" };
const members = [
  { id: "engine", name: "Engine" },
  { id: "files", name: "Files" },
];
const rowsOf = (messages: ChannelMessage[], unreadAfter?: number) =>
  transcriptRows(messages, { lead, members, unreadAfter });

const rowIds = (rows: TranscriptRow[]) =>
  rows.map((row) => {
    switch (row.type) {
      case "user":
        return [row.message.id];
      case "agent":
        return row.entries.map(({ message }) => message.id);
      case "system":
        return row.messages.map(({ id }) => id);
    }
  });

/** The entries of a transcript that is one agent's run. */
function runOf(messages: ChannelMessage[]): AgentRunEntry[] {
  const [row] = rowsOf(messages);
  if (row?.type !== "agent") throw new Error("Expected an agent run.");
  return row.entries;
}

const member = { channelId: "channel", id: "files", name: "Files" };

describe("transcript rows", () => {
  test("one agent's consecutive messages share a row", () => {
    const messages = [
      agentPost(1, "engine", at(26, 10, 0)),
      agentPost(2, "engine", at(26, 10, 9)),
      agentPost(3, "lead", at(26, 10, 10)),
      agentPost(4, "engine", at(26, 10, 11)),
    ];
    expect(rowIds(rowsOf(messages))).toEqual([["1", "2"], ["3"], ["4"]]);
  });

  test("a run breaks after ten minutes, at midnight, and where unread messages begin", () => {
    expect(
      rowIds(
        rowsOf([agentPost(1, "engine", at(26, 10, 0)), agentPost(2, "engine", at(26, 10, 11))]),
      ),
    ).toEqual([["1"], ["2"]]);
    expect(
      rowIds(
        rowsOf([agentPost(1, "engine", at(26, 23, 58)), agentPost(2, "engine", at(27, 0, 3))]),
      ),
    ).toEqual([["1"], ["2"]]);
    expect(
      rowIds(
        rowsOf([agentPost(1, "engine", at(26, 10, 0)), agentPost(2, "engine", at(26, 10, 1))], 1),
      ),
    ).toEqual([["1"], ["2"]]);
  });

  test("a row keeps its first message's identity as later messages join it", () => {
    const rows = rowsOf([agentPost(1, "engine"), agentPost(2, "engine")]);
    expect(rows.map(({ key }) => key)).toEqual(["1"]);
  });

  test("user messages stand alone", () => {
    const messages = [userPost(1, at(26, 10, 0)), userPost(2, at(26, 10, 1))];
    expect(rowIds(rowsOf(messages))).toEqual([["1"], ["2"]]);
  });

  test("joins merge, as do one actor's removals, while a question remains an agent message", () => {
    const messages = [
      event(1, { type: "member_joined", member }),
      event(2, { type: "member_joined", member: { ...member, id: "engine", name: "Engine" } }),
      event(3, { type: "member_left", actor: { type: "user" }, member }),
      event(4, { type: "member_left", actor: { type: "user" }, member }),
      event(5, { type: "member_left", actor: { type: "agent", agentId: "lead" }, member }),
      { ...agentPost(6, "lead", at(26, 9, 1)), request: true as const },
    ];
    expect(rowIds(rowsOf(messages))).toEqual([["1", "2"], ["3", "4"], ["5"], ["6"]]);
  });

  test("only consecutive artifact shares or removals by the same actor merge", () => {
    const artifact = { file: { kind: "machine" as const, path: "/plan.md" }, title: "Plan" };
    const actor = (agentId?: string) =>
      agentId ? { type: "agent" as const, agentId } : { type: "user" as const };
    const messages = [
      event(1, { type: "artifact_shared", actor: actor("engine"), artifact }),
      event(2, { type: "artifact_shared", actor: actor("engine"), artifact }),
      event(3, { type: "artifact_removed", actor: actor("engine"), artifact }),
      event(4, { type: "artifact_removed", actor: actor("engine"), artifact }),
      event(5, { type: "artifact_removed", actor: actor("files"), artifact }),
      event(6, { type: "artifact_removed", actor: actor(), artifact }),
      event(7, { type: "artifact_removed", actor: actor(), artifact }),
    ];
    expect(rowIds(rowsOf(messages))).toEqual([["1", "2"], ["3", "4"], ["5"], ["6", "7"]]);
  });
});

describe("transcript dividers", () => {
  test("a day divider precedes the first row and each row that begins a new day", () => {
    const rows = rowsOf([
      agentPost(1, "engine", at(26, 23, 50)),
      userPost(2, at(26, 23, 55)),
      agentPost(3, "engine", at(27, 0, 5)),
    ]);
    expect(rows.map(({ divider }) => divider?.day?.getDate())).toEqual([26, undefined, 27]);
  });

  test("the New rule precedes the first unread row, unless nothing loaded comes before it", () => {
    const messages = [userPost(1), agentPost(2, "lead"), agentPost(3, "lead")];
    expect(rowsOf(messages, 2).map(({ divider }) => divider?.unread ?? false)).toEqual([
      false,
      false,
      true,
    ]);
    expect(rowsOf(messages, 0).some(({ divider }) => divider?.unread)).toBe(false);
  });

  test("a day and the unread messages beginning together share one divider", () => {
    const rows = rowsOf(
      [agentPost(1, "lead", at(26, 18, 0)), agentPost(2, "lead", at(27, 8, 0))],
      1,
    );
    expect(rows[1]!.divider).toEqual({ day: new Date(at(27, 8, 0)), unread: true });
  });
});

describe("agent run entries", () => {
  test("an entry names who it wakes, and none when it's for the user", () => {
    const addressee = (agentId: string, content: string) =>
      runOf([agentPost(1, agentId, undefined, content)])[0]!.addressee;
    expect(addressee("lead", "@engine Build the lift.")).toBe("Engine");
    expect(addressee("engine", "Lift built.")).toBe("Lead");
    expect(addressee("lead", "@everyone Standup.")).toBe("Everyone");
    expect(addressee("lead", "The lift is ready.")).toBeUndefined();
  });

  test("the body drops the mentions it opens with, since the addressee names them", () => {
    const [entry] = runOf([agentPost(1, "lead", undefined, "@engine Build the lift.")]);
    expect(entry!.body).toBe("Build the lift.");
    expect(entry!.message.content).toBe("@engine Build the lift.");
  });

  test("only a run's first message names its author", () => {
    const run = runOf([agentPost(1, "lead"), agentPost(2, "lead")]);
    expect(run.map(({ startsRun }) => startsRun)).toEqual([true, false]);
  });

  test("after the first, a header appears only when the addressee changes or the lead asks", () => {
    const run = runOf([
      agentPost(1, "lead", undefined, "@engine Build the lift."),
      agentPost(2, "lead", undefined, "@engine Then the stairs."),
      agentPost(3, "lead", undefined, "@files Index the plans."),
      { ...agentPost(4, "lead", undefined, "@files Which plan?"), request: true },
    ]);
    expect(run.map(({ showHeader }) => showHeader)).toEqual([true, false, true, true]);
  });

  test("coordination between agents collapses; messages for the user and requests stay whole", () => {
    const run = runOf([
      agentPost(1, "lead", undefined, "@engine Build the lift."),
      agentPost(2, "lead", undefined, "The lift is ready."),
      { ...agentPost(3, "lead", undefined, "@engine Which floor?"), request: true },
    ]);
    expect(run.map(({ collapsible }) => collapsible)).toEqual([true, false, false]);
  });

  test("a request stays pending until a later user message acknowledges it", () => {
    const asked = { ...agentPost(1, "lead"), request: true as const };
    expect(runOf([asked])[0]!.request).toBe("pending");
    expect(runOf([asked, userPost(3)])[0]!.request).toBe("acknowledged");
  });

  test("a later request pends while an earlier reply keeps acknowledging its own", () => {
    const rows = rowsOf([
      { ...agentPost(1, "lead"), request: true },
      userPost(3),
      { ...agentPost(4, "lead"), request: true },
    ]);
    const requests = rows.flatMap((row) =>
      row.type === "agent" ? row.entries.map(({ request }) => request) : [],
    );
    expect(requests).toEqual(["acknowledged", "pending"]);
  });
});

describe("your messages view", () => {
  const yours = (messages: ChannelMessage[], unreadAfter?: number, bookmarks?: number[]) =>
    transcriptRows(messages, { lead, members, bookmarks, unreadAfter, view: "yours" });

  test("shows the user's messages and agent messages for them", () => {
    const messages = [
      userPost(1),
      agentPost(2, "lead", undefined, "The lift is ready."),
      agentPost(3, "lead", undefined, "@engine Build the stairs."),
      agentPost(4, "lead", undefined, "@everyone Standup."),
      agentPost(5, "engine", undefined, "Stairs built."),
      event(6, { type: "member_joined", member }),
    ];
    expect(rowIds(yours(messages))).toEqual([["1"], ["2"]]);
  });

  test("a bookmarked message stays, even between agents", () => {
    const messages = [userPost(1), agentPost(2, "engine", undefined, "Stairs built.")];
    expect(rowIds(yours(messages, undefined, [2]))).toEqual([["1"], ["2"]]);
  });

  test("a request stays, even when it also addresses agents", () => {
    const asked = {
      ...agentPost(1, "lead", undefined, "@engine Which floor?"),
      request: true as const,
    };
    expect(rowIds(yours([asked]))).toEqual([["1"]]);
  });

  test("an agent's messages for the user form one run across the coordination between them", () => {
    const rows = yours([
      agentPost(1, "lead", undefined, "The lift is ready."),
      agentPost(2, "engine", undefined, "Stairs next?"),
      agentPost(3, "lead", undefined, "@engine Yes."),
      agentPost(4, "lead", undefined, "The stairs are next."),
    ]);
    expect(rowIds(rows)).toEqual([["1", "4"]]);
  });

  test("the New rule precedes the first unread message the view shows", () => {
    const rows = yours(
      [
        userPost(1),
        agentPost(2, "lead", undefined, "@engine Build the lift."),
        agentPost(3, "lead", undefined, "The lift is ready."),
      ],
      1,
    );
    expect(rows.map(({ divider }) => divider?.unread ?? false)).toEqual([false, true]);
  });
});

describe("message rows", () => {
  const rows = rowsOf([
    userPost(1),
    agentPost(2, "lead"),
    agentPost(3, "lead"),
    event(4, { type: "member_joined", member }),
  ]);

  test("locate a user's message and an agent's message within its run", () => {
    expect(messageRowIndex(rows, 1)).toBe(0);
    expect(messageRowIndex(rows, 3)).toBe(1);
  });

  test("exclude system messages and those outside loaded history", () => {
    expect(messageRowIndex(rows, 4)).toBe(-1);
    expect(messageRowIndex(rows, 9)).toBe(-1);
  });
});

describe("transcript day labels", () => {
  const now = new Date(2026, 8, 28, 20, 0);

  test("recent days are named relatively and older ones in full", () => {
    expect(transcriptDayLabel(new Date(2026, 8, 28, 1, 0), now)).toBe("Today");
    expect(transcriptDayLabel(new Date(2026, 8, 27, 23, 0), now)).toBe("Yesterday");
    expect(transcriptDayLabel(new Date(2026, 8, 26, 8, 0), now)).toContain("September 26");
  });

  test("a day from another year includes the year", () => {
    expect(transcriptDayLabel(new Date(2025, 8, 26, 8, 0), now)).toContain("2025");
  });
});
