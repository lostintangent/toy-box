import { describe, expect, test } from "bun:test";
import { createAppPane } from "@apps/model";
import { createChannelPane } from "@channels/model";
import { machineFile, sessionFile } from "@files/model";
import { createEditorPane } from "@files/model/panes";
import { createScreenPane } from "@screens/model";
import { createSessionPane } from "@sessions/model/panes";
import { parseRootPanes, serializeRootPanes } from "./kinds";

describe("workspace roots", () => {
  test("opens each kind's URL items as root panes, in the URL's order", () => {
    const file = machineFile("/repo/notes.md");

    expect(parseRootPanes({ files: [file], sessions: ["A", "B"], apps: ["app-a"] })).toEqual([
      createEditorPane(file),
      createSessionPane("A"),
      createSessionPane("B"),
      createAppPane("app-a"),
    ]);
  });

  test("deduplicates roots and caps them at the workspace's capacity", () => {
    expect(
      parseRootPanes({ sessions: ["A", "A", "B"], channels: ["c"], screens: ["s"], apps: ["a"] }),
    ).toEqual([
      createSessionPane("A"),
      createSessionPane("B"),
      createChannelPane("c"),
      createScreenPane("s"),
    ]);
  });

  test("ignores unknown keys and invalid items", () => {
    expect(
      parseRootPanes({ sessions: ["A", 1], files: [{ kind: "bogus" }], apps: "a", other: ["x"] }),
    ).toEqual([createSessionPane("A")]);
  });

  test("writes every root kind back to the URL it came from", () => {
    const search = {
      sessions: ["A"],
      files: [sessionFile("A", "plan.md")],
      apps: ["app-a"],
      channels: ["channel-a"],
    };
    expect(serializeRootPanes(parseRootPanes(search))).toEqual(search);
    expect(serializeRootPanes(parseRootPanes({ screens: ["window"] }))).toEqual({
      screens: ["window"],
    });
  });
});
