import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  allDecisions,
  findIntentEntity,
  parseIntent,
  type IntentDefinition,
  type IntentExhibit,
  type MapSection,
  type SequenceSection,
} from "./model/index";
import { compareIntentToSavedVersion, saveIntentVersion } from "./model/checkpoints";
import { workItems } from "./model/sequence";
import { updateIntentExhibit, updateIntentRecord } from "./model/transitions";
import { IntentExhibitEditor } from "./ExhibitEditor";
import { IntentRecordEditor, IntentWorkEditor } from "./RecordEditor";
import { IntentMapSection, IntentSequenceSection } from "./sections";
import { IntentChangesPanel } from "./VersionControl";

const CONNECTIONS_MAP: MapSection = {
  id: "restoration-path",
  title: "Follow the restoration path",
  purpose: "Trace the behavior into its active runtime consequences.",
  kind: "map",
  collapsed: false,
  layout: "flow",
  relations: [
    "context-causes-change",
    "changed-realized-by-restore-call",
    "changed-previews-provisional",
    "changed-realized-by-settled",
  ],
};

const NETWORK_MAP: MapSection = {
  ...CONNECTIONS_MAP,
  id: "restoration-network",
  title: "See restoration branch out",
  layout: "network",
  relations: [
    "changed-realized-by-restore-call",
    "changed-previews-provisional",
    "changed-realized-by-settled",
  ],
};

const PATHS_MAP: MapSection = {
  id: "restoration-routes",
  title: "See restoration branch and rejoin",
  purpose: "Keep the exact restore and active policy routes on one shared map.",
  kind: "map",
  collapsed: false,
  layout: "paths",
  paths: [
    {
      id: "restore-route",
      title: "Restore the durable value",
      purpose: "Follow the changed behavior into its exact call and settled result.",
      root: "context",
      relations: [
        "context-causes-change",
        "changed-realized-by-restore-call",
        "changed-realized-by-settled",
      ],
    },
    {
      id: "preview-route",
      title: "Try the preview policy",
      purpose: "Follow the same changed behavior into the provisional result.",
      root: "context",
      relations: ["context-causes-change", "changed-previews-provisional"],
    },
  ],
  regions: [
    {
      id: "reason",
      title: "Why this changes",
      entities: ["context"],
    },
    {
      id: "behavior",
      title: "Changed behavior",
      entities: ["changed"],
    },
    {
      id: "results",
      title: "Exact and chosen results",
      entities: ["restore-call", "provisional-addition", "settled-addition"],
    },
  ],
  relations: ["restore-call-points-back-to-change"],
};

function fixture(): IntentDefinition {
  const parsed = parseIntent(
    JSON.stringify({
      title: "Trace a lifecycle",
      sections: [
        {
          id: "context",
          title: "Context",
          purpose: "Orient the reader.",
          kind: "prose",
          body: "Context should orient the effective changes.",
        },
        {
          id: "behavior",
          title: "Behavior",
          purpose: "Define the observable outcome.",
          kind: "records",
          view: "cards",
          provenance: "code",
          subject: "Outcome",
          fields: [{ id: "result", label: "Result", kind: "text" }],
          items: [
            {
              id: "baseline",
              subject: "Existing baseline",
              change: "existing",
              values: { result: "unchanged context" },
              provenance: "runtime.ts#baseline",
            },
            {
              id: "changed",
              subject: "Modified behavior",
              change: "modified",
              values: { result: "restores the durable value" },
              explanation: "The runtime reconstructs the visible state.",
              provenance: "runtime.ts#restore",
            },
          ],
        },
        {
          id: "exact-restore",
          title: "Exact restore handoff",
          purpose: "Keep the exact runtime call beside the behavior it realizes.",
          kind: "exhibits",
          provenance: "optional",
          items: [
            {
              id: "restore-call",
              title: "Restore call",
              kind: "code",
              change: "new",
              description: "The runtime passes the durable value through one explicit call.",
              language: "typescript",
              content: "await runtime.restore(durableState);\n",
            },
          ],
        },
        {
          id: "implementation",
          title: "Implementation work",
          purpose: "Sequence independently verifiable work against the settled intent.",
          kind: "sequence",
          fields: [{ id: "done", label: "Done when", kind: "text" }],
          items: [
            {
              id: "foundation-work",
              title: "Build durable state",
              values: { done: "The persistence boundary is tested." },
            },
            {
              id: "integration-work",
              title: "Integrate restoration",
              values: { done: "The runtime restores state end to end." },
            },
          ],
        },
        {
          id: "decisions",
          title: "Decisions",
          purpose: "Project selected alternatives.",
          kind: "decisions",
          items: [
            {
              id: "pending-policy",
              question: "Which provisional policy should be explored?",
              options: [
                {
                  id: "preview",
                  label: "Preview policy",
                  adds: [
                    {
                      sectionId: "behavior",
                      id: "provisional-addition",
                      subject: "Provisional addition",
                      change: "new",
                      values: { result: "not yet decided" },
                    },
                  ],
                  relations: [
                    {
                      id: "changed-previews-provisional",
                      from: "changed",
                      to: "provisional-addition",
                      kind: "causes",
                    },
                  ],
                },
              ],
              chosen: "preview",
              status: "provisional",
              blocking: false,
              dependsOn: [],
            },
            {
              id: "settled-policy",
              question: "Which settled policy applies?",
              options: [
                {
                  id: "restore",
                  label: "Restore durable state",
                  tradeoff: "Requires an explicit reconstruction boundary.",
                  adds: [
                    {
                      sectionId: "behavior",
                      id: "settled-addition",
                      subject: "Settled addition",
                      change: "new",
                      values: { result: "part of the effective intent" },
                    },
                  ],
                  relations: [
                    {
                      id: "changed-realized-by-settled",
                      from: "changed",
                      to: "settled-addition",
                      kind: "realized-by",
                    },
                    {
                      id: "settled-implemented-by-foundation",
                      from: "settled-addition",
                      to: "foundation-work",
                      kind: "implemented-by",
                    },
                  ],
                },
              ],
              chosen: "restore",
              status: "decided",
              blocking: true,
              dependsOn: [],
            },
          ],
        },
        CONNECTIONS_MAP,
      ],
      relations: [
        {
          id: "context-causes-change",
          from: "context",
          to: "changed",
          kind: "causes",
          label: "motivates",
        },
        {
          id: "changed-implemented-by-integration",
          from: "changed",
          to: "integration-work",
          kind: "implemented-by",
        },
        {
          id: "changed-realized-by-restore-call",
          from: "changed",
          to: "restore-call",
          kind: "realized-by",
          label: "uses this exact call",
        },
        {
          id: "restore-call-points-back-to-change",
          from: "restore-call",
          to: "changed",
          kind: "preserves",
          label: "keeps the changed outcome visible",
        },
        {
          id: "restore-call-implemented-by-integration",
          from: "restore-call",
          to: "integration-work",
          kind: "implemented-by",
        },
        {
          id: "decision-implemented-by-integration",
          from: "settled-policy",
          to: "integration-work",
          kind: "implemented-by",
        },
        {
          id: "integration-depends-on-foundation",
          from: "integration-work",
          to: "foundation-work",
          kind: "depends-on",
          label: "requires durable state",
        },
      ],
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function deliverySequence(definition: IntentDefinition) {
  const section = definition.sections.find((candidate) => candidate.id === "implementation");
  if (!section || section.kind !== "sequence") throw new Error("Missing sequence fixture");
  return section;
}

function stagedDeliveryFixture(): IntentDefinition {
  const definition = fixture();
  const delivery = deliverySequence(definition);
  if (!("items" in delivery)) throw new Error("Expected flat sequence fixture");
  const [foundation, integration] = delivery.items;
  if (!foundation || !integration) throw new Error("Missing sequence work");
  const { items: _items, ...common } = delivery;
  const staged: SequenceSection = {
    ...common,
    stages: [
      {
        id: "foundation",
        title: "Establish durable state",
        items: [foundation],
      },
      {
        id: "integration",
        title: "Move restoration onto it",
        items: [integration],
      },
    ],
  };
  definition.sections = definition.sections.map((section) =>
    section.id === delivery.id ? staged : section,
  );
  const parsed = parseIntent(JSON.stringify(definition));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

test("derives a connected map from root and active option relationships", () => {
  const markup = renderToStaticMarkup(
    <IntentMapSection definition={fixture()} section={CONNECTIONS_MAP} onInspect={() => {}} />,
  );

  expect(markup).toContain(">1<");
  expect(markup).toContain("motivates");
  expect(markup).toContain("Modified behavior");
  expect(markup).toContain("Restore call");
  expect(markup).toContain("uses this exact call");
  expect(markup).toContain("Provisional addition");
  expect(markup).toContain("Settled addition");
  expect(markup).toContain("Preview policy · Trying");
  expect(markup).toContain("Restore durable state · Decided");
  expect(markup).not.toContain("requires durable state");
  expect(markup.match(/data-entity-node="changed"/g)).toHaveLength(1);
});

test("groups an authored network by its source entities", () => {
  const markup = renderToStaticMarkup(
    <IntentMapSection definition={fixture()} section={NETWORK_MAP} onInspect={() => {}} />,
  );

  expect(markup.match(/data-entity-node="changed"/g)).toHaveLength(1);
  expect(markup).toContain("Restore call");
  expect(markup).toContain("Provisional addition");
  expect(markup).toContain("Settled addition");
});

test("renders rooted path summaries over one shared staged graph", () => {
  const markup = renderToStaticMarkup(
    <IntentMapSection definition={fixture()} section={PATHS_MAP} onInspect={() => {}} />,
  );

  expect(markup).toContain("Restore the durable value");
  expect(markup).toContain("Try the preview policy");
  expect(markup).toContain('data-map-path="restore-route"');
  expect(markup).toContain('data-map-path="preview-route"');
  expect(markup).toContain('data-path-relation="context-causes-change"');
  expect(markup).toContain("Why this changes");
  expect(markup).toContain("Exact and chosen results");
  expect(markup).toContain("keeps the changed outcome visible");
  expect(markup).toContain("uses this exact call");
  expect(markup.match(/data-entity-node=/g)).toHaveLength(5);
  expect(markup.match(/data-entity-node="changed"/g)).toHaveLength(1);
  expect(markup).not.toContain("<foreignObject");
});

test("keeps one focused graph item visible across inline visualizations", () => {
  const definition = fixture();
  const sequence = definition.sections.find((section) => section.id === "implementation");
  if (!sequence || sequence.kind !== "sequence") throw new Error("Missing sequence fixture");
  const focusedEntityId = "changed" as const;
  const map = renderToStaticMarkup(
    <IntentMapSection
      definition={definition}
      section={CONNECTIONS_MAP}
      focusedEntityId={focusedEntityId}
      onInspect={() => {}}
    />,
  );
  const sequenceMarkup = renderToStaticMarkup(
    <IntentSequenceSection
      definition={definition}
      section={sequence}
      focusedEntityId={focusedEntityId}
      onInspect={() => {}}
    />,
  );
  expect(map).toContain('data-focused="true"');
  expect(sequenceMarkup).toContain('data-focused="true"');
});

test("builds a record editor from domain-local records fields", () => {
  const definition = fixture();
  const section = definition.sections.find((item) => item.id === "behavior");
  if (!section || section.kind !== "records") throw new Error("Missing behavior fixture");
  const record = section.items.find((item) => item.id === "changed");
  if (!record) throw new Error("Missing changed fixture");

  const markup = renderToStaticMarkup(
    <IntentRecordEditor
      section={section}
      record={record}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );

  expect(markup).toContain(">Outcome</span>");
  expect(markup).toContain(">Result</span>");
  expect(markup).toContain("Modified behavior");
  expect(markup).toContain("restores the durable value");
  expect(markup).toContain("Save changes");
});

test("builds a lean editor from native sequence fields", () => {
  const definition = fixture();
  const section = deliverySequence(definition);
  const item = workItems(section)[0]!;
  const markup = renderToStaticMarkup(
    <IntentWorkEditor section={section} item={item} onSave={() => undefined} onCancel={() => {}} />,
  );

  expect(markup).toContain(">Work</span>");
  expect(markup).toContain(">Done when</span>");
  expect(markup).toContain("Build durable state");
  expect(markup).not.toContain(">Change</span>");
  expect(markup).not.toContain(">Source</span>");
  expect(markup).not.toContain(">Notes</span>");
});

test("builds an exhibit editor without flattening exact source into prose fields", () => {
  const definition = fixture();
  const entity = findIntentEntity(definition, "restore-call");
  if (!entity || !("exhibit" in entity)) throw new Error("Missing exhibit fixture");

  const markup = renderToStaticMarkup(
    <IntentExhibitEditor
      section={entity.section}
      exhibit={entity.exhibit}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );

  expect(markup).toContain(">Exact content</span>");
  expect(markup).toContain("await runtime.restore(durableState);");
  expect(markup).toContain("typescript");
  expect(markup).toContain("Save changes");

  const image: IntentExhibit = {
    id: "architecture-image",
    title: "Architecture",
    kind: "image",
    change: "new",
    uri: "./architecture.svg",
  };
  const imageMarkup = renderToStaticMarkup(
    <IntentExhibitEditor
      section={{ ...entity.section, items: [image] }}
      exhibit={image}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );
  expect(imageMarkup).toContain(">Image URI</span>");
  expect(imageMarkup).toContain('value="./architecture.svg"');

  const html: IntentExhibit = {
    id: "interactive-prototype",
    title: "Interactive prototype",
    kind: "html",
    change: "new",
    uri: "./prototype.html",
  };
  const htmlMarkup = renderToStaticMarkup(
    <IntentExhibitEditor
      section={{ ...entity.section, items: [html] }}
      exhibit={html}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );
  expect(htmlMarkup).toContain(">HTML URI</span>");
  expect(htmlMarkup).toContain('value="./prototype.html"');

  const inlineSvg: IntentExhibit = {
    id: "embedded-architecture",
    title: "Embedded architecture",
    kind: "html",
    change: "new",
    content: '<svg viewBox="0 0 10 10"></svg>',
  };
  const inlineSvgMarkup = renderToStaticMarkup(
    <IntentExhibitEditor
      section={{ ...entity.section, items: [inlineSvg] }}
      exhibit={inlineSvg}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );
  expect(inlineSvgMarkup).toContain(">HTML content</span>");
  expect(inlineSvgMarkup).toContain("&lt;svg viewBox=&quot;0 0 10 10&quot;&gt;");
});

test("shows compact changes since a saved graph version", () => {
  const saved = saveIntentVersion(fixture(), "2026-03-19T12:00:00.000Z");
  const editedRecord = updateIntentRecord(saved, "changed", {
    subject: "Restored behavior",
    change: "modified",
    values: { result: "restores the durable value" },
    explanation: "The runtime reconstructs the visible state.",
    provenance: "runtime.ts#restore",
  });
  const edited = updateIntentExhibit(editedRecord, "restore-call", {
    title: "Restore call",
    kind: "code",
    change: "new",
    description: "The runtime passes the durable value through one explicit call.",
    language: "typescript",
    content: "await runtime.restore(snapshot.durableState);\n",
  });
  const comparison = compareIntentToSavedVersion(edited);
  if (!comparison) throw new Error("Missing version comparison");
  const markup = renderToStaticMarkup(
    <IntentChangesPanel
      comparison={comparison}
      focusedEntityId={"changed"}
      onInspect={() => {}}
      onSaveVersion={() => {}}
    />,
  );

  expect(markup).toContain("2026-03-19 12:00 UTC");
  expect(markup).toContain("Restored behavior");
  expect(markup).toContain("Previously Modified behavior");
  expect(markup).toContain("Exact detail");
  expect(markup).toContain("Restore call");
  expect(markup).toContain('data-focused="true"');
  expect(markup).toContain("Update checkpoint");
});

test("derives implementation phases, coverage, and dependency reasons", () => {
  const definition = fixture();
  const markup = renderToStaticMarkup(
    <IntentSequenceSection
      definition={definition}
      section={deliverySequence(definition)}
      onInspect={() => {}}
    />,
  );

  expect(markup).not.toContain("steps in order");
  expect(markup).not.toContain("Every agreed outcome has a home");
  expect(markup).toContain("Build durable state");
  expect(markup).not.toContain("After Build durable state");
  expect(markup).toContain("Integrate restoration");
  expect(markup).not.toContain("requires durable state");
  expect(markup).toContain("Done when");
  expect(markup).toContain('aria-label="Intent sources"');
  expect(markup).toContain("Settled addition");
  expect(markup).toContain("Modified behavior");
  expect(markup).not.toContain("<details");
  expect(markup).not.toContain("agreed outcomes land here");
  expect(markup).not.toContain(">New</span>");
  expect(markup).not.toContain("Can start now");
  expect(markup).not.toContain("Opens after earlier work");
  expect(markup).not.toContain("Ready after");
  expect(markup).not.toContain("Handles");
  expect(markup).not.toContain("Still needs a home");
  expect(markup).not.toContain("Provisional addition");
});

test("keeps phase guidance when independent work can move together", () => {
  const definition = fixture();
  definition.relations = definition.relations.filter(
    (relation) => relation.id !== "integration-depends-on-foundation",
  );

  const markup = renderToStaticMarkup(
    <IntentSequenceSection
      definition={definition}
      section={deliverySequence(definition)}
      onInspect={() => {}}
    />,
  );

  expect(markup).not.toContain("pieces of work across");
  expect(markup).toContain("Can start now");
  expect(markup).toContain("2 pieces can move together");
  expect(markup).not.toContain("No earlier delivery work");
  expect(markup).not.toContain("Ready after");
});

test("uses authored names for dependency-derived stages", () => {
  const definition = stagedDeliveryFixture();
  const markup = renderToStaticMarkup(
    <IntentSequenceSection
      definition={definition}
      section={deliverySequence(definition)}
      onInspect={() => {}}
    />,
  );

  expect(markup).toContain("Establish durable state");
  expect(markup).toContain("Move restoration onto it");
  expect(markup).not.toContain("Can start now");
  expect(markup).not.toContain("Opens after earlier work");
});

test("explains prerequisite-only work retained from an unsettled option", () => {
  const definition = fixture();
  const decision = allDecisions(definition).find((item) => item.id === "settled-policy")!;
  decision.status = "provisional";
  decision.blocking = false;

  const markup = renderToStaticMarkup(
    <IntentSequenceSection
      definition={definition}
      section={deliverySequence(definition)}
      onInspect={() => {}}
    />,
  );
  expect(markup).toContain("Build durable state");
  expect(markup).toContain("Integrate restoration");
  expect(markup).toContain("Enables later work; no intent source links here directly.");
  expect(markup).not.toContain("Covers 0 obligations");
});

test("indexes inspectable relationship targets", () => {
  const entity = findIntentEntity(fixture(), "changed");

  expect(entity?.label).toBe("Modified behavior");
  expect(entity?.detail).toBe("restores the durable value");
});
