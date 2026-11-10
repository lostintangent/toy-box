import { afterEach, beforeEach, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { copilotProvider } from "./copilot/provider";
import { codexProvider } from "./codex/provider";
import * as cli from "./cli";
import type { ModelInfo } from "../model";
import * as workspaceSettings from "@workspace/server/state/settings";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { invokeRoute } from "@/server/testFixtures";
import { Route as ModelsRoute } from "../routes/v1/models";
import {
  getProviderCatalog,
  listModels,
  listSessions,
  readSession,
  sessionProviders,
  stopProviders,
  updateProvider,
} from "./index";

const MODEL: ModelInfo = { id: "model", name: "Available model", provider: "codex" };

beforeEach(() => {
  spyOn(workspaceSettings, "getSettings").mockResolvedValue({
    ...DEFAULT_SETTINGS,
    disabledProviders: [],
  });
  spyOn(cli, "isInstalled").mockReturnValue(false);
  for (const provider of sessionProviders) {
    spyOn(provider, "isSignedIn").mockResolvedValue(true);
    spyOn(provider, "stop").mockResolvedValue();
  }
});
afterEach(async () => {
  await stopProviders();
  mock.restore();
});

test("no installed providers returns empty catalogs without starting a provider", async () => {
  const readers = sessionProviders.flatMap((provider) => [
    spyOn(provider, "listModels"),
    spyOn(provider, "listSessions"),
  ]);
  expect(await listModels()).toEqual([]);
  expect(await listSessions()).toEqual([]);
  expect((await getProviderCatalog()).providers).toEqual(
    sessionProviders.map(({ id, name }) => ({ id, name, status: "unavailable" })),
  );
  for (const reader of readers) expect(reader).not.toHaveBeenCalled();
});

test("the public models route returns model choices without caching", async () => {
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  spyOn(codexProvider, "listModels").mockResolvedValue([MODEL]);
  const response = await invokeRoute(ModelsRoute, new Request("http://toy-box.test/api/v1/models"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    models: [{ ...MODEL, providerName: codexProvider.name }],
    defaultModel: { provider: MODEL.provider, name: MODEL.id },
  });
});

test("failed discovery quietly leaves provider settings reachable and the next request retries", async () => {
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  const read = spyOn(codexProvider, "listModels")
    .mockRejectedValueOnce(new Error("Please authenticate"))
    .mockResolvedValue([MODEL]);
  const events = mock();
  onTestFinished(subscribeWorkspaceEvents(events));
  expect(await listModels()).toEqual([]);
  expect(await getProviderCatalog()).toMatchObject({
    models: [],
    providers: expect.arrayContaining([{ id: "codex", name: codexProvider.name, status: "ready" }]),
  });
  expect(await listModels()).toEqual([{ ...MODEL, providerName: codexProvider.name }]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(events.mock.calls).toEqual([[{ type: "providers.changed" }]]);
});

test("catalog reads don't wait for discovery, which broadcasts once it completes", async () => {
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  const discovery = Promise.withResolvers<ModelInfo[]>();
  spyOn(codexProvider, "listModels").mockReturnValue(discovery.promise);
  const events = mock();
  onTestFinished(subscribeWorkspaceEvents(events));
  expect(await getProviderCatalog()).toMatchObject({
    models: [],
    providers: expect.arrayContaining([{ id: "codex", name: codexProvider.name, status: "ready" }]),
  });
  expect(events).not.toHaveBeenCalled();

  discovery.resolve([MODEL]);
  await listModels();
  expect(events.mock.calls).toEqual([[{ type: "providers.changed" }]]);
  expect((await getProviderCatalog()).models).toEqual([
    { ...MODEL, providerName: codexProvider.name },
  ]);
});

test("a signed-out provider keeps its sessions but contributes no models", async () => {
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  spyOn(codexProvider, "isSignedIn").mockResolvedValue(false);
  const models = spyOn(codexProvider, "listModels");
  spyOn(codexProvider, "listSessions").mockResolvedValue([
    { nativeId: "history", createdAt: new Date(0), updatedAt: new Date(0) },
  ]);
  expect(await listModels()).toEqual([]);
  expect(await getProviderCatalog()).toEqual({
    providers: sessionProviders.map(({ id, name }) => ({
      id,
      name,
      status: id === "codex" ? "signedOut" : "unavailable",
    })),
    models: [],
  });
  expect((await listSessions()).map(({ nativeId }) => nativeId)).toEqual(["history"]);
  expect(models).not.toHaveBeenCalled();
});

test("an unavailable provider does not suppress the other provider's catalog", async () => {
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "copilot" || id === "codex");
  spyOn(copilotProvider, "listModels").mockRejectedValue(new Error("Please authenticate"));
  spyOn(codexProvider, "listModels").mockResolvedValue([
    { id: "model", name: "Model", provider: "codex" },
  ]);
  expect((await listModels()).map((model) => model.provider)).toEqual(["codex"]);
});

test("a session read names its provider, and an unavailable or failing provider reads none", async () => {
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  const session = { nativeId: "native", createdAt: new Date(0), updatedAt: new Date(0) };
  const read = spyOn(codexProvider, "readSession").mockResolvedValueOnce(session);
  const unavailable = spyOn(copilotProvider, "readSession");

  expect(await readSession("codex", "native")).toEqual({ ...session, providerId: "codex" });
  expect(await readSession("copilot", "native")).toBeUndefined();
  expect(unavailable).not.toHaveBeenCalled();

  read.mockRejectedValueOnce(new Error("Codex stopped"));
  expect(await readSession("codex", "native")).toBeUndefined();
});

test("concurrent discovery is shared and later reads reuse the cached catalog", async () => {
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  const discovery = Promise.withResolvers<ModelInfo[]>();
  const read = spyOn(codexProvider, "listModels").mockReturnValue(discovery.promise);
  const first = listModels();
  const concurrent = listModels();
  discovery.resolve([MODEL]);
  const expected = [{ ...MODEL, providerName: codexProvider.name }];
  expect(await Promise.all([first, concurrent])).toEqual([expected, expected]);
  expect(await listModels()).toEqual(expected);
  expect(read).toHaveBeenCalledTimes(1);
});

test("enablement gates discovery and toggling reuses each provider's model cache", async () => {
  const disabledProviders = ["claude"];
  spyOn(workspaceSettings, "getSettings").mockImplementation(async () => ({
    ...DEFAULT_SETTINGS,
    disabledProviders,
  }));
  spyOn(cli, "isInstalled").mockReturnValue(true);
  const readers = sessionProviders.map((provider) => ({
    models: spyOn(provider, "listModels").mockResolvedValue([{ ...MODEL, provider: provider.id }]),
    sessions: spyOn(provider, "listSessions").mockResolvedValue([
      {
        nativeId: provider.id,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]),
  }));
  expect((await listModels()).map(({ provider }) => provider)).toEqual(["copilot", "codex"]);
  expect((await listSessions()).map(({ providerId }) => providerId)).toEqual(["copilot", "codex"]);
  expect(readers[2]!.models).not.toHaveBeenCalled();
  expect(readers[2]!.sessions).not.toHaveBeenCalled();

  disabledProviders.push("copilot", "codex");
  expect(await listModels()).toEqual([]);
  expect(await listSessions()).toEqual([]);
  disabledProviders.length = 0;
  expect((await listModels()).map(({ provider }) => provider)).toEqual([
    "copilot",
    "codex",
    "claude",
  ]);
  for (const reader of readers) expect(reader.models).toHaveBeenCalledTimes(1);
});

test("provider shutdown clears the model catalog", async () => {
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  const read = spyOn(codexProvider, "listModels").mockResolvedValue([MODEL]);
  await listModels();
  await stopProviders();
  await listModels();
  expect(read).toHaveBeenCalledTimes(2);
});

test.each([true, false])(
  "successful update checks refresh only that provider's models (version changed: %s)",
  async (updated) => {
    spyOn(cli, "isInstalled").mockImplementation((id) => id === "copilot" || id === "codex");
    const copilotModels = spyOn(copilotProvider, "listModels").mockResolvedValue([
      { ...MODEL, provider: "copilot" },
    ]);
    const codexModels = spyOn(codexProvider, "listModels")
      .mockResolvedValueOnce([MODEL])
      .mockResolvedValue([{ ...MODEL, id: "new-model" }]);
    await listModels();
    const result = { version: "1.1.0", updated };
    spyOn(cli, "updateProvider").mockResolvedValue(result);
    const stop = spyOn(codexProvider, "stop");
    const events = mock();
    onTestFinished(subscribeWorkspaceEvents(events));

    expect(await updateProvider("codex")).toEqual(result);
    expect(events.mock.calls).toEqual([[{ type: "providers.changed" }]]);
    expect((await listModels()).map(({ id }) => id)).toEqual(["model", "new-model"]);
    expect(copilotModels).toHaveBeenCalledTimes(1);
    expect(codexModels).toHaveBeenCalledTimes(2);
    expect(stop).not.toHaveBeenCalled();
  },
);

test("failed updates retain the cached catalog without notifying clients", async () => {
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  const read = spyOn(codexProvider, "listModels").mockResolvedValue([MODEL]);
  const catalog = await listModels();
  spyOn(cli, "updateProvider").mockRejectedValue(new Error("Update failed"));
  const events = mock();
  onTestFinished(subscribeWorkspaceEvents(events));

  await expect(updateProvider("codex")).rejects.toThrow("Update failed");
  expect(await listModels()).toEqual(catalog);
  expect(read).toHaveBeenCalledTimes(1);
  expect(events).not.toHaveBeenCalled();
});
