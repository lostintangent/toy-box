import { describe, expect, test } from "bun:test";
import { isLiveActivity, reduceSessionsActivity, type SessionsActivity } from "./activity";

const sessionId = "session-a";

describe("session activity", () => {
  test("makes running, waiting, unread, and idle mutually exclusive", () => {
    let activities = reduceSessionsActivity({}, { type: "session.running", sessionId, at: 1 });
    expect(activities).toEqual({ [sessionId]: { status: "running", since: 1 } });

    activities = reduceSessionsActivity(activities, { type: "session.waiting", sessionId, at: 2 });
    expect(activities).toEqual({ [sessionId]: { status: "waiting", since: 1 } });

    activities = reduceSessionsActivity(activities, { type: "session.unread", sessionId });
    expect(activities).toEqual({ [sessionId]: { status: "unread" } });
  });

  test("remembers when a run began across its live transitions", () => {
    let activities = reduceSessionsActivity({}, { type: "session.running", sessionId, at: 1 });
    activities = reduceSessionsActivity(activities, { type: "session.waiting", sessionId, at: 3 });
    expect(activities[sessionId]).toEqual({ status: "waiting", since: 1 });

    activities = reduceSessionsActivity(activities, { type: "session.running", sessionId, at: 4 });
    expect(activities[sessionId]).toEqual({ status: "running", since: 1 });

    activities = reduceSessionsActivity(activities, {
      type: "session.background",
      sessionId,
      at: 5,
    });
    expect(activities[sessionId]).toEqual({ status: "background", since: 1 });
    expect(isLiveActivity(activities[sessionId]?.status)).toBe(true);

    activities = reduceSessionsActivity(activities, { type: "session.running", sessionId, at: 7 });
    expect(activities[sessionId]).toEqual({ status: "running", since: 1 });
  });

  test.each(["session.unread", "session.idle", "session.deleted"] as const)(
    "starts a new run after %s",
    (type) => {
      const ended = reduceSessionsActivity(
        { [sessionId]: { status: "running", since: 1 } },
        { type, sessionId },
      );
      expect(
        reduceSessionsActivity(ended, { type: "session.running", sessionId, at: 5 })[sessionId],
      ).toEqual({ status: "running", since: 5 });
    },
  );

  test("reading forgets only unread results", () => {
    const running: SessionsActivity = { [sessionId]: { status: "running", since: 1 } };
    expect(reduceSessionsActivity(running, { type: "session.read", sessionId })).toBe(running);
    expect(
      reduceSessionsActivity(
        { [sessionId]: { status: "unread" } },
        { type: "session.read", sessionId },
      ),
    ).toEqual({});
  });

  test("changes only the session an event names", () => {
    const other = { status: "unread" } as const;
    const activities = reduceSessionsActivity(
      { "session-b": other },
      { type: "session.running", sessionId, at: 1 },
    );

    expect(activities).toEqual({
      [sessionId]: { status: "running", since: 1 },
      "session-b": other,
    });
    expect(activities["session-b"]).toBe(other);
  });

  test("keeps its identity when nothing changes", () => {
    const running: SessionsActivity = { [sessionId]: { status: "running", since: 1 } };
    const unread: SessionsActivity = { [sessionId]: { status: "unread" } };

    expect(reduceSessionsActivity(running, { type: "session.running", sessionId, at: 2 })).toBe(
      running,
    );
    expect(reduceSessionsActivity(unread, { type: "session.unread", sessionId })).toBe(unread);
    expect(reduceSessionsActivity(running, { type: "session.idle", sessionId: "session-b" })).toBe(
      running,
    );
    expect(reduceSessionsActivity(running, { type: "inbox.changed" })).toBe(running);
  });
});
