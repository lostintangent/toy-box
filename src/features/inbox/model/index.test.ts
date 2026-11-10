import { expect, test } from "bun:test";
import type { Worker } from "@workers/model";
import { inboxEntryFromWorker } from "./index";

const worker = {
  type: "inbox",
  sessionId: "inbox-result",
  createdAt: new Date(0).toISOString(),
  ephemeral: false,
} satisfies Worker;
const identity = { id: worker.sessionId, createdAt: worker.createdAt };

test("a Worker without an outcome is pending while active and interrupted once it isn't", () => {
  expect(inboxEntryFromWorker(worker, true)).toEqual({ ...identity, kind: "pending" });
  expect(inboxEntryFromWorker(worker, false)).toEqual({
    ...identity,
    kind: "error",
    error: expect.stringContaining("interrupted"),
  });
});

test.each<{ metadata: Worker["metadata"] }>([
  { metadata: null },
  { metadata: { message: 42, artifact: "report.md" } },
  { metadata: { message: "Ready", artifact: "../outside.md" } },
  { metadata: { message: "Ready", artifact: "/outside.md" } },
  { metadata: { message: "Ready", artifact: "reports/../../outside.md" } },
  { metadata: { message: "Ready", artifact: "reports\\outside.md" } },
])("unreadable metadata %j produces an error without exposing its artifact", ({ metadata }) => {
  expect(inboxEntryFromWorker({ ...worker, metadata }, false)).toEqual({
    ...identity,
    kind: "error",
    error: expect.any(String),
  });
});
