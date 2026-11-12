import { expect, onTestFinished, spyOn, test } from "bun:test";
import { PushDatabase } from "@push/server/database";
import * as database from "@/server/database";
import { invokeRoute, openTestDatabase } from "@/server/testFixtures";
import { Route as InstallRoute } from "./push/$registrationID";
import { Route as TopicRoute } from "./push/$registrationID.topics.$topic";

const id = "00000000-0000-4000-8000-000000000001";
const registration = { token: "1122", environment: "sandbox" };
const request = (method: string, body?: object | string) =>
  new Request("http://127.0.0.1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "object" ? JSON.stringify(body) : body,
  });
const register = (body: object | string) =>
  invokeRoute(InstallRoute, request("PUT", body), { registrationID: id });
const subscribe = (topic: string, body: object | string) =>
  invokeRoute(TopicRoute, request("PUT", body), { registrationID: id, topic });
const remove = (topic?: string) =>
  topic === undefined
    ? invokeRoute(InstallRoute, request("DELETE"), { registrationID: id })
    : invokeRoute(TopicRoute, request("DELETE"), { registrationID: id, topic });
async function setup() {
  const db = await openTestDatabase();
  const access = spyOn(database, "getStateDatabase");
  onTestFinished(() => access.mockRestore());
  return { access, store: new PushDatabase(db) };
}

test("wire writes require an install, distinguish create/update and independently remove topics", async () => {
  const { store } = await setup();
  expect((await subscribe("requests", {})).status).toBe(404);
  expect((await register({ registrationID: id, ...registration })).status).toBe(400);
  expect((await register(registration)).status).toBe(201);
  expect((await register(registration)).status).toBe(204);
  expect((await subscribe("requests", {})).status).toBe(204);
  expect((await subscribe("opaque", { token: "3344", startedAt: 900.125 })).status).toBe(204);
  for (const body of [
    { token: "1122" },
    { token: "3344", startedAt: 900.125, environment: "production" },
  ])
    expect((await subscribe("opaque", body)).status).toBe(400);
  expect((await store.subscriptions()).find(({ topic }) => topic === "requests")).toMatchObject({
    token: "1122",
    pushType: "alert",
  });
  expect((await remove("requests")).status).toBe(204);
  expect((await store.subscriptions()).map(({ topic }) => topic)).toEqual(["opaque"]);
  expect((await remove()).status).toBe(204);
  expect(await store.subscriptions()).toEqual([]);
  expect((await remove()).status).toBe(204);
});

for (const [kind, write] of [
  ["registration", register],
  ["subscription", (body: string) => subscribe("requests", body)],
] as const)
  test(`${kind} rejects malformed JSON before database access`, async () => {
    const { access } = await setup();
    for (const body of ["", "{", "["]) {
      const response = await write(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request." });
    }
    expect(access).not.toHaveBeenCalled();
  });
