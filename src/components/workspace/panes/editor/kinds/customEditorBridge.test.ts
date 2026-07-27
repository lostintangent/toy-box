import { describe, expect, test } from "bun:test";
import {
  CUSTOM_EDITOR_CHANGE_MESSAGE_TYPE,
  CUSTOM_EDITOR_RENDER_MESSAGE_TYPE,
  CUSTOM_EDITOR_WORKER_MESSAGE_TYPE,
  CUSTOM_EDITOR_WORKER_RESULT_MESSAGE_TYPE,
  createCustomEditorRenderMessage,
  injectCustomEditorBridge,
} from "./customEditorBridge";
import { sessionFile } from "@/lib/files/workspaceFile";

describe("custom editor bridge", () => {
  test("defines the Toybox contract before the template runs", () => {
    const templateScript = "window.templateStarted = true";
    const document = injectCustomEditorBridge(
      `<html><head><script>${templateScript}</script></head><body></body></html>`,
    );

    expect(document.indexOf("window.Toybox =")).toBeLessThan(document.indexOf(templateScript));
    expect(document).toContain(CUSTOM_EDITOR_RENDER_MESSAGE_TYPE);
    expect(document).toContain(CUSTOM_EDITOR_CHANGE_MESSAGE_TYPE);
    expect(document).toContain(CUSTOM_EDITOR_WORKER_MESSAGE_TYPE);
    expect(document).toContain(CUSTOM_EDITOR_WORKER_RESULT_MESSAGE_TYPE);
    expect(document).toContain("onRender(handler)");
    expect(document).toContain("emitChange(content)");
    expect(document).toContain("spawnWorker(options)");
    expect(document).toContain("pendingWorkers: latest.pendingWorkers");
  });

  test("projects only renderer-relevant worker identity, name, and opaque metadata", () => {
    expect(
      createCustomEditorRenderMessage("one,two", false, [
        {
          sessionId: "artifact-worker-a",
          file: sessionFile("source-a", "report.csv"),
          name: "Generate row 18",
          metadata: { type: "generate-row", placeholderId: "row-a" },
        },
      ]),
    ).toEqual({
      type: CUSTOM_EDITOR_RENDER_MESSAGE_TYPE,
      content: "one,two",
      editable: false,
      pendingWorkers: [
        {
          sessionId: "artifact-worker-a",
          name: "Generate row 18",
          metadata: { type: "generate-row", placeholderId: "row-a" },
        },
      ],
    });
  });
});
