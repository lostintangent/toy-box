import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Checklist } from "@/shared/ui/checklist";
import { channelTaskItems } from "./channelTaskItems";

test.each([
  { added: 12_345, removed: 0, addedText: "+12.3K", removedText: "\u22120" },
  { added: 0, removed: 12_345, addedText: "+0", removedText: "\u221212.3K" },
])(
  "collapsed parents show compact totals and retain the zero side: %j",
  ({ added, removed, addedText, removedText }) => {
    const items = channelTaskItems({
      tasks: [
        {
          id: "t1",
          title: "Release",
          status: "done",
          children: [{ id: "t2", title: "Build", status: "done", diff: { added, removed } }],
        },
      ],
      owners: [],
      artifacts: [],
      onArtifactOpen: () => {},
    });
    const html = renderToStaticMarkup(<Checklist items={items} />);
    const label = `${added} lines added, ${removed} lines removed`;
    expect(html).toContain(`>${addedText}</span>`);
    expect(html).toContain(`>${removedText}</span>`);
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain(`title="${label}"`);
  },
);

test("pending tasks keep their titles without displaying reported diff counts", () => {
  const items = channelTaskItems({
    tasks: [
      { id: "t1", title: "Queued", status: "pending", diff: { added: 0, removed: 0 } },
      { id: "t2", title: "Next", status: "pending", diff: { added: 12, removed: 3 } },
    ],
    owners: [],
    artifacts: [],
    onArtifactOpen: () => {},
  });
  const html = renderToStaticMarkup(<Checklist items={items} />);
  expect(html).toContain("Queued");
  expect(html).toContain("Next");
  expect(html).not.toContain("lines added");
  expect(html).not.toContain("lines removed");
});

test("artifact icons belong to their task, not its parents, and omit visible titles", () => {
  const items = channelTaskItems({
    tasks: [
      {
        id: "t1",
        title: "Release",
        status: "done",
        children: [
          { id: "t2", title: "Plan", status: "done", artifactId: "machine:/project/brief.md" },
        ],
      },
      { id: "t3", title: "Review", status: "done", artifactId: "machine:/missing.md" },
    ],
    owners: [],
    artifacts: [
      {
        id: "machine:/project/brief.md",
        file: { kind: "machine", path: "/project/brief.md" },
        title: "Project brief",
        sharedAt: "2026-10-06T00:00:00Z",
      },
    ],
    onArtifactOpen: () => {},
  });
  const collapsed = renderToStaticMarkup(<Checklist items={items} />);
  expect(collapsed).not.toContain("Project brief");
  expect(collapsed).toContain('aria-label="Artifact unavailable"');
  expect(collapsed).toContain('disabled=""');
  const html = renderToStaticMarkup(<Checklist items={items[0]!.children!} />);
  expect(html).toContain('aria-label="Open Project brief"');
  expect(html).toContain('title="Project brief"');
  expect(html).not.toContain(">Project brief<");
});
