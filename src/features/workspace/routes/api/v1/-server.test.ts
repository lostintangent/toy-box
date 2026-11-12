import { expect, test } from "bun:test";
import { invokeRoute, openTestDatabase } from "@/server/testFixtures";
import { computerName } from "@workspace/server/state/environment";
import { Route } from "./server.index";

function patch(body: unknown) {
  return invokeRoute(
    Route,
    new Request("http://toy-box.test/api/v1/server", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("an update changes only the details it names, by each one's settings rule", async () => {
  await openTestDatabase();

  const named = await (await patch({ name: "Studio" })).json();
  expect(named).toMatchObject({ name: "Studio", accentColor: "#facc15" });

  const colored = await (await patch({ accentColor: "#2f6f8f" })).json();
  expect(colored).toMatchObject({ id: named.id, name: "Studio", accentColor: "#2f6f8f" });

  const unnamed = await (await patch({ name: "" })).json();
  expect(unnamed).toMatchObject({ name: computerName, accentColor: "#2f6f8f" });

  expect((await patch({ accentColor: "teal" })).status).toBe(400);
});
