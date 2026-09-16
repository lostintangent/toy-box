import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { copilotProvider } from "./copilot/provider";
import { codexProvider } from "./codex/provider";
import { listModels } from "./index";

afterEach(() => mock.restore());

test.each(["copilot", "codex"])("%s alone supplies the available model catalog", async (id) => {
  const available = id === "copilot" ? copilotProvider : codexProvider;
  const unavailable = id === "copilot" ? codexProvider : copilotProvider;
  spyOn(unavailable, "isInstalled").mockReturnValue(false);
  const unavailableModels = spyOn(unavailable, "listModels").mockRejectedValue(
    new Error("Must not start"),
  );
  spyOn(available, "isInstalled").mockReturnValue(true);
  const model = { id: "same-name", name: "Available model", provider: id };
  spyOn(available, "listModels").mockResolvedValue([model]);
  expect(await listModels()).toEqual([{ ...model, providerName: available.name }]);
  expect(unavailableModels).not.toHaveBeenCalled();
});

test("an unavailable provider does not suppress the other provider's catalog", async () => {
  spyOn(copilotProvider, "isInstalled").mockReturnValue(true);
  spyOn(codexProvider, "isInstalled").mockReturnValue(true);
  spyOn(copilotProvider, "listModels").mockRejectedValue(new Error("Please authenticate"));
  spyOn(codexProvider, "listModels").mockResolvedValue([
    { id: "model", name: "Model", provider: "codex" },
  ]);
  expect((await listModels()).map((model) => model.provider)).toEqual(["codex"]);
});
