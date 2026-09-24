import { afterEach, beforeEach, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { copilotProvider } from "./copilot/provider";
import { codexProvider } from "./codex/provider";
import * as cli from "./cli";
import type { ModelInfo } from "../model";
import * as workspaceSettings from "@workspace/server/state/settings";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import {
  getProviderCatalog,
  listModels,
  listSessions,
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
  for (const provider of sessionProviders) spyOn(provider, "stop").mockResolvedValue();
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
    sessionProviders.map(({ id, name }) => ({ id, name, installed: false })),
  );
  for (const reader of readers) expect(reader).not.toHaveBeenCalled();
});

test("failed discovery leaves provider settings reachable and the next request can retry", async () => {
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  const read = spyOn(codexProvider, "listModels")
    .mockRejectedValueOnce(new Error("Please authenticate"))
    .mockResolvedValue([MODEL]);
  expect(await getProviderCatalog()).toMatchObject({
    models: [],
    providers: expect.arrayContaining([{ id: "codex", name: codexProvider.name, installed: true }]),
  });
  expect(await listModels()).toEqual([{ ...MODEL, providerName: codexProvider.name }]);
  expect(read).toHaveBeenCalledTimes(2);
});

test.each(sessionProviders.map((provider) => provider.id))(
  "%s alone supplies the available model catalog",
  async (id) => {
    const available = sessionProviders.find((provider) => provider.id === id)!;
    const unavailableModels = sessionProviders
      .filter((provider) => provider !== available)
      .map((provider) =>
        spyOn(provider, "listModels").mockRejectedValue(new Error("Must not start")),
      );
    spyOn(cli, "isInstalled").mockImplementation((providerId) => providerId === id);
    const model = { id: "same-name", name: "Available model", provider: id };
    spyOn(available, "listModels").mockResolvedValue([model]);
    expect(await listModels()).toEqual([{ ...model, providerName: available.name }]);
    for (const models of unavailableModels) expect(models).not.toHaveBeenCalled();
  },
);

test("an unavailable provider does not suppress the other provider's catalog", async () => {
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "copilot" || id === "codex");
  spyOn(copilotProvider, "listModels").mockRejectedValue(new Error("Please authenticate"));
  spyOn(codexProvider, "listModels").mockResolvedValue([
    { id: "model", name: "Model", provider: "codex" },
  ]);
  expect((await listModels()).map((model) => model.provider)).toEqual(["codex"]);
});

test("concurrent discovery is shared and the catalog stays cached for the server lifetime", async () => {
  let now = 1_000_000;
  spyOn(Date, "now").mockImplementation(() => now);
  spyOn(cli, "isInstalled").mockImplementation((id) => id === "codex");
  const discovery = Promise.withResolvers<ModelInfo[]>();
  const read = spyOn(codexProvider, "listModels").mockReturnValue(discovery.promise);
  const first = listModels();
  const concurrent = listModels();
  discovery.resolve([MODEL]);
  const expected = [{ ...MODEL, providerName: codexProvider.name }];
  expect(await Promise.all([first, concurrent])).toEqual([expected, expected]);
  now += 24 * 60 * 60_000;
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
        id: provider.id,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]),
  }));
  expect((await listModels()).map(({ provider }) => provider)).toEqual(["copilot", "codex"]);
  expect((await listSessions()).map(({ provider }) => provider?.id)).toEqual(["copilot", "codex"]);
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
