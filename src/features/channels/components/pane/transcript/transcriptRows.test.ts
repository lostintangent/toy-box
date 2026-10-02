import { describe, expect, test } from "bun:test";
import type { ChannelMessage } from "@channels/model";
import { channelRequestStates } from "@channels/model/requests";
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

function agentPost(sequence: number, agentId: string, timestamp: string): ChannelMessage {
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

  test("membership changes merge, and requests render no row of their own", () => {
    const messages = [
      event(1, { type: "member_joined", member }),
      event(2, { type: "member_joined", member: { ...member, id: "engine", name: "Engine" } }),
      agentPost(3, "lead", at(26, 9, 1)),
      event(4, { type: "user_attention_requested", requestSequence: 3 }),
    ];
    expect(rowIds(transcriptRows(messages))).toEqual([["1", "2"], ["3"]]);
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
  const request = (sequence: number, requestSequence: number) =>
    event(sequence, { type: "user_attention_requested", requestSequence });
  const pendingRow = (messages: ChannelMessage[]) =>
    pendingRequestRow(transcriptRows(messages), channelRequestStates(messages));

  test("is the latest pending request's message and the row holding it, even mid-run", () => {
    const messages = [
      agentPost(1, "lead", at(26, 10, 0)),
      request(2, 1),
      userPost(3, at(26, 10, 2)),
      agentPost(4, "lead", at(26, 10, 3)),
      agentPost(5, "lead", at(26, 10, 4)),
      request(6, 4),
      request(7, 5),
    ];
    expect(pendingRow(messages)).toEqual({ sequence: 5, index: 2 });
  });

  test("is absent without a request, once the user replies, or while its message isn't loaded", () => {
    expect(pendingRow([agentPost(1, "lead", at(26, 10, 0))])).toBeUndefined();
    expect(
      pendingRow([agentPost(1, "lead", at(26, 10, 0)), request(2, 1), userPost(3, at(26, 10, 2))]),
    ).toBeUndefined();
    expect(pendingRow([request(2, 1)])).toBeUndefined();
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
