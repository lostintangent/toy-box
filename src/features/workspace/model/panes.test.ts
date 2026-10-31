import { describe, expect, test } from "bun:test";
import { createAppPane } from "@apps/model";
import { machineFile, sessionFile } from "@files/model";
import { createEditorPane } from "@files/model/panes";
import { INBOX_PANE } from "@inbox/model";
import { createScreenPane } from "@screens/model";
import type { SessionCanvas } from "@sessions/model";
import { createCanvasPane, createSessionPane } from "@sessions/model/panes";
import {
  deriveReachablePaneIds,
  deriveVisibleWorkspacePanes,
  type WorkspacePane,
} from "@workspace/model/panes";

function derivePanes(
  rootPanes: WorkspacePane[],
  panePublications: Record<string, WorkspacePane[]>,
) {
  return deriveVisibleWorkspacePanes({ rootPanes, panePublications });
}

function canvas(overrides: Partial<SessionCanvas> = {}): SessionCanvas {
  return {
    key: JSON.stringify(["user:documint", "documint-markdown-agent", "review-plan"]),
    extensionId: "user:documint",
    canvasId: "documint-markdown-agent",
    instanceId: "review-plan",
    title: "Review Plan",
    url: "http://127.0.0.1:51460/?instanceId=review-plan",
    revision: 1,
    ...overrides,
  };
}

describe("workspace pane graph", () => {
  test("shows linked panes in their publisher's order after the roots", () => {
    const root = createAppPane("factory");
    const linked = [
      createSessionPane("child", true),
      createEditorPane(machineFile("/repo/notes.md")),
    ];

    expect(derivePanes([root], { [root.id]: linked })).toEqual([root, ...linked]);
  });

  test("shows a pane that is both a root and linked once", () => {
    const session = createSessionPane("A");
    const screen = createScreenPane("window");
    const linkedScreen = createScreenPane("window", "A");

    expect(derivePanes([session, screen], { [session.id]: [linkedScreen] })).toEqual([
      session,
      screen,
    ]);
  });

  test("lets the Inbox pane publish an Inbox artifact", () => {
    const artifactPane = createEditorPane(sessionFile("inbox-1", "result.md"), "edit");
    const panePublications = { [INBOX_PANE.id]: [artifactPane] };

    expect(derivePanes([INBOX_PANE], panePublications)).toEqual([INBOX_PANE, artifactPane]);
    expect(deriveReachablePaneIds([INBOX_PANE], panePublications)).toEqual([
      INBOX_PANE.id,
      artifactPane.id,
    ]);
  });

  test("keeps selected session panes first and appends canvases within the four-pane workspace cap", () => {
    const firstCanvas = canvas();
    const secondCanvas = canvas({
      key: JSON.stringify(["user:documint", "documint-markdown-agent", "notes"]),
      instanceId: "notes",
      title: "Notes",
      revision: 3,
    });

    expect(
      derivePanes([createSessionPane("A"), createSessionPane("B")], {
        [createSessionPane("A").id]: [
          createCanvasPane("A", firstCanvas),
          createCanvasPane("A", secondCanvas),
        ],
      }),
    ).toEqual([
      createSessionPane("A"),
      createSessionPane("B"),
      createCanvasPane("A", firstCanvas),
      createCanvasPane("A", secondCanvas),
    ]);
  });

  test("keeps a linked session visible ahead of the panes it publishes", () => {
    const appPane = createAppPane("factory");
    const coordinatorPane = createSessionPane("coordinator", true);
    const artifacts = ["plan.md", "implementation.md", "review.md"].map((path) =>
      createEditorPane(sessionFile("coordinator", path)),
    );

    expect(
      deriveVisibleWorkspacePanes({
        rootPanes: [appPane],
        panePublications: {
          [appPane.id]: [coordinatorPane],
          [coordinatorPane.id]: artifacts,
        },
      }),
    ).toEqual([appPane, coordinatorPane, artifacts[0], artifacts[1]]);
  });

  test("focuses an overflow artifact or child without losing its publishing session", () => {
    const root = createSessionPane("A");
    const artifacts = ["one.md", "two.md", "three.md", "four.toy"].map((path) =>
      createEditorPane(sessionFile("A", path)),
    );
    const child = createSessionPane("child", true);
    const panePublications = { [root.id]: [...artifacts, child] };
    for (const focusedPane of [artifacts[3]!, child]) {
      expect(
        deriveVisibleWorkspacePanes({
          rootPanes: [root],
          panePublications,
          focusedPaneId: focusedPane.id,
        }),
      ).toEqual([root, artifacts[0], artifacts[1], focusedPane]);
    }
    expect(deriveVisibleWorkspacePanes({ rootPanes: [root], panePublications })).toEqual([
      root,
      ...artifacts.slice(0, 3),
    ]);
  });

  test("retains a publishing app when explicit focus displaces a root in a full workspace", () => {
    const rootPanes = ["a", "b", "c", "owner"].map(createAppPane);
    const child = createSessionPane("child", true);
    const panePublications = { [rootPanes[3]!.id]: [child] };
    expect(
      deriveVisibleWorkspacePanes({
        rootPanes,
        panePublications,
        focusedPaneId: child.id,
      }),
    ).toEqual([rootPanes[0], rootPanes[1], child, rootPanes[3]]);
    expect(
      deriveVisibleWorkspacePanes({
        rootPanes,
        panePublications,
        focusedPaneId: "departed",
      }),
    ).toEqual(rootPanes);
  });
});
