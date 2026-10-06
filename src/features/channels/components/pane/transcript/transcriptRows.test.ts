import { describe, expect, test } from "bun:test";
import type { ChannelConversationMessage, ChannelMessage } from "@channels/model";
import {
  pendingRequestRow,
  transcriptDayLabel,
  transcriptRows,
  type TranscriptRow,
} from "./transcriptRows";

// Local wall-clock times keep day boundaries independent of the test machine's time zone.
function at(day: number, hour: number, minute: number): string {
  return new Date(2026, 8, day, hour, minute).toISOString();
}

function agentPost(
  sequence: number,
  agentId: string,
  timestamp: string,
): ChannelConversationMessage {
  const sender = { type: "agent", agentId } as const;
  return { id: `${sequence}`, sequence, timestamp, sender, content: `Update ${sequence}` };
}

function userPost(sequence: number, timestamp: string): ChannelMessage {
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

const rowIds = (rows: TranscriptRow[]) => rows.map((row) => row.messages.map(({ id }) => id));
const member = { channelId: "channel", id: "files", name: "Files" };

describe("transcript rows", () => {
  test("one agent's consecutive messages share a row", () => {
    const messages = [
      agentPost(1, "engine", at(26, 10, 0)),
      agentPost(2, "engine", at(26, 10, 9)),
      agentPost(3, "lead", at(26, 10, 10)),
      agentPost(4, "engine", at(26, 10, 11)),
    ];
    expect(rowIds(transcriptRows(messages))).toEqual([["1", "2"], ["3"], ["4"]]);
  });

  test("a run breaks after ten minutes, at midnight, and where unread messages begin", () => {
    expect(
      rowIds(
        transcriptRows([
          agentPost(1, "engine", at(26, 10, 0)),
          agentPost(2, "engine", at(26, 10, 11)),
        ]),
      ),
    ).toEqual([["1"], ["2"]]);
    expect(
      rowIds(
        transcriptRows([
          agentPost(1, "engine", at(26, 23, 58)),
          agentPost(2, "engine", at(27, 0, 3)),
        ]),
      ),
    ).toEqual([["1"], ["2"]]);
    expect(
      rowIds(
        transcriptRows(
          [agentPost(1, "engine", at(26, 10, 0)), agentPost(2, "engine", at(26, 10, 1))],
          1,
        ),
      ),
    ).toEqual([["1"], ["2"]]);
  });

  test("user messages stand alone", () => {
    const messages = [userPost(1, at(26, 10, 0)), userPost(2, at(26, 10, 1))];
    expect(rowIds(transcriptRows(messages))).toEqual([["1"], ["2"]]);
  });

  test("membership changes merge while a question remains an ordinary agent message", () => {
    const messages = [
      event(1, { type: "member_joined", member }),
      event(2, { type: "member_joined", member: { ...member, id: "engine", name: "Engine" } }),
      { ...agentPost(3, "lead", at(26, 9, 1)), request: true as const },
    ];
    expect(rowIds(transcriptRows(messages))).toEqual([["1", "2"], ["3"]]);
  });

  test("only consecutive artifact shares from the same agent merge", () => {
    const artifact = { file: { kind: "machine" as const, path: "/plan.md" }, title: "Plan" };
    const messages = ["engine", "engine", "files", undefined, undefined].map((agentId, index) =>
      event(index + 1, {
        type: "artifact_shared",
        actor: agentId ? { type: "agent", agentId } : { type: "user" },
        artifact,
      }),
    );
    expect(rowIds(transcriptRows(messages))).toEqual([["1", "2"], ["3"], ["4"], ["5"]]);
  });

  test("a day divider precedes the first row and each row that begins a new day", () => {
    const rows = transcriptRows([
      agentPost(1, "engine", at(26, 23, 50)),
      userPost(2, at(26, 23, 55)),
      agentPost(3, "engine", at(27, 0, 5)),
    ]);
    expect(rows.map(({ startsDay }) => startsDay)).toEqual([true, false, true]);
  });

  test("the New rule precedes the first unread row, unless nothing loaded comes before it", () => {
    const messages = [
      userPost(1, at(26, 10, 0)),
      agentPost(2, "lead", at(26, 10, 1)),
      agentPost(3, "lead", at(26, 10, 2)),
    ];
    expect(transcriptRows(messages, 2).map(({ startsUnread }) => startsUnread)).toEqual([
      false,
      false,
      true,
    ]);
    expect(transcriptRows(messages, 0).some(({ startsUnread }) => startsUnread)).toBe(false);
  });
});

describe("pending request row", () => {
  const rows = transcriptRows([
    userPost(1, at(26, 10, 0)),
    agentPost(2, "lead", at(26, 10, 1)),
    { ...agentPost(3, "lead", at(26, 10, 2)), request: true },
  ]);

  test("locates the canonical pending question within an agent run", () => {
    expect(pendingRequestRow(rows, 3)).toEqual({ sequence: 3, index: 1 });
  });

  test("has no placement after acknowledgement or outside loaded history", () => {
    expect(pendingRequestRow(rows, null)).toBeUndefined();
    expect(pendingRequestRow(rows, 9)).toBeUndefined();
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
