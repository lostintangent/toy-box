import { expect, onTestFinished, spyOn, test } from "bun:test";
import * as database from "@/server/database";
import { PushDatabase } from "./database";
import { registerResponse, subscribeResponse, removeResponse } from "./api";

const id = "00000000-0000-4000-8000-000000000001";
const registration = { token: "1122", environment: "sandbox" };
const request = (body: object | string) =>
  new Request("http://127.0.0.1", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
async function setup() {
  const db = await database.createTestDatabase();
  const access = spyOn(database, "getStateDatabase").mockResolvedValue(db);
  onTestFinished(async () => {
    access.mockRestore();
    await db.close();
  });
  return { access, store: new PushDatabase(db) };
}

test("wire writes require an install, distinguish create/update and independently remove topics", async () => {
  const { store } = await setup();
  expect((await subscribeResponse(id, "requests", request({}))).status).toBe(404);
  expect(
    (await registerResponse(id, request({ registrationID: id, ...registration }))).status,
  ).toBe(400);
  expect((await registerResponse(id, request(registration))).status).toBe(201);
  expect((await registerResponse(id, request(registration))).status).toBe(204);
  expect((await subscribeResponse(id, "requests", request({}))).status).toBe(204);
  expect(
    (await subscribeResponse(id, "opaque", request({ token: "3344", startedAt: 900.125 }))).status,
  ).toBe(204);
  for (const body of [
    { token: "1122" },
    { token: "3344", startedAt: 900.125, environment: "production" },
  ])
    expect((await subscribeResponse(id, "opaque", request(body))).status).toBe(400);
  expect((await store.subscriptions()).find(({ topic }) => topic === "requests")).toMatchObject({
    token: "1122",
    pushType: "alert",
  });
  expect((await removeResponse(id, "requests")).status).toBe(204);
  expect((await store.subscriptions()).map(({ topic }) => topic)).toEqual(["opaque"]);
  expect((await removeResponse(id)).status).toBe(204);
  expect(await store.subscriptions()).toEqual([]);
  expect((await removeResponse(id)).status).toBe(204);
});

for (const [kind, respond] of [
  ["registration", (body: Request) => registerResponse(id, body)],
  ["subscription", (body: Request) => subscribeResponse(id, "requests", body)],
] as const)
  test(`${kind} rejects malformed JSON before database access`, async () => {
    const { access } = await setup();
    for (const body of ["", "{", "["]) {
      const response = await respond(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid push registration." });
    }
    expect(access).not.toHaveBeenCalled();
  });
