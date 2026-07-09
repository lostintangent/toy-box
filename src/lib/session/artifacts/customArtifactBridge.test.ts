import { describe, expect, test } from "bun:test";
import {
  CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE,
  CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE,
  injectCustomArtifactBridge,
} from "./customArtifactBridge";

describe("custom artifact bridge", () => {
  test("defines the Toybox contract before the template runs", () => {
    const templateScript = "window.templateStarted = true";
    const document = injectCustomArtifactBridge(
      `<html><head><script>${templateScript}</script></head><body></body></html>`,
    );

    expect(document.indexOf("window.Toybox =")).toBeLessThan(document.indexOf(templateScript));
    expect(document).toContain(CUSTOM_ARTIFACT_RENDER_MESSAGE_TYPE);
    expect(document).toContain(CUSTOM_ARTIFACT_CHANGE_MESSAGE_TYPE);
    expect(document).toContain("onRender(handler)");
    expect(document).toContain("emitChange(content)");
  });
});
