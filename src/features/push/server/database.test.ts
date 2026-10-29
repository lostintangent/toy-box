import { expect, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "@/server/database";
import { PushDatabase } from "./database";

const registration = {
  registrationID: "00000000-0000-4000-8000-000000000001",
  token: "aabb",
  environment: "sandbox",
} as const;
async function setup() {
  const db = await createTestDatabase();
  onTestFinished(() => db.close());
  return { db, push: new PushDatabase(db) };
}

test("rebind and unregister cascade only the selected install's subscriptions", async () => {
  const { push } = await setup();
  const other = {
    ...registration,
    registrationID: "00000000-0000-4000-8000-000000000002",
    token: "ccdd",
  };
  await push.register(registration);
  await push.register(other);
  await push.subscribe(
    { registrationID: registration.registrationID, token: null, startedAt: null },
    "requests",
  );
  await push.register({ ...other, token: registration.token });
  expect(
    await push.subscribe(
      { registrationID: registration.registrationID, token: null, startedAt: null },
      "requests",
    ),
  ).toBe(false);
  expect(await push.subscriptions()).toEqual([]);
  await push.subscribe(
    { registrationID: other.registrationID, token: "1122", startedAt: 100 },
    "opaque",
  );
  await push.unregister(other.registrationID);
  expect(await push.subscriptions()).toEqual([]);
});

test("subscriptions require an install and inherit its environment and default device address", async () => {
  const { push } = await setup();
  const input = { registrationID: registration.registrationID, token: null, startedAt: null };
  expect(await push.subscribe(input, "requests")).toBe(false);
  await push.register(registration);
  expect(await push.subscribe(input, "requests")).toBe(true);
  await push.subscribe({ ...input, token: "1122", startedAt: 100.125 }, "work:42");
  expect(await push.subscriptions()).toEqual([
    { ...registration, topic: "requests", pushType: "alert", startedAt: null },
    {
      ...registration,
      topic: "work:42",
      pushType: "liveactivity",
      token: "1122",
      startedAt: 100.125,
    },
  ]);
  await push.register({ ...registration, token: "ccdd", environment: "production" });
  await push.pruneToken(registration);
  expect((await push.subscriptions()).map(({ environment }) => environment)).toEqual([
    "production",
    "production",
  ]);
  expect((await push.subscriptions())[0]?.token).toBe("ccdd");
  await push.subscribe({ ...input, token: "3344", startedAt: 1000 }, "work:42");
  await push.unsubscribe(registration.registrationID, "work:42", "1122");
  expect((await push.subscriptions())[1]).toMatchObject({ token: "3344", startedAt: 1000 });
  await push.pruneToken({ token: "3344", environment: "sandbox" });
  expect(await push.subscriptions()).toHaveLength(2);
  await push.pruneToken({ token: "3344", environment: "production" });
  expect((await push.subscriptions()).map(({ topic }) => topic)).toEqual(["requests"]);
});
