import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseIntent, type IntentDefinition, type IntentSection } from "./model/index";
import { IntentSectionContent, SectionPanel } from "./sections";

function fixture(): IntentDefinition {
  const parsed = parseIntent(
    JSON.stringify({
      title: "Flexible form",
      sections: [
        {
          id: "overview",
          title: "Prose",
          purpose: "Explain the direction.",
          kind: "prose",
          body: "This board keeps **context** beside `clientId` and the [structured changes](https://example.com/changes).\n\n- The reading remains cohesive.",
        },
        {
          id: "domain",
          title: "Domain map",
          purpose: "Show a column-oriented group with mixed child types.",
          kind: "group",
          layout: "columns",
          sections: [
            {
              id: "concepts",
              title: "Concepts",
              purpose: "Name changed concepts.",
              kind: "records",
              view: "cards",
              provenance: "code",
              subject: "Concept",
              fields: [{ id: "role", label: "Role", kind: "text" }],
              items: [
                {
                  id: "block",
                  subject: "Block",
                  change: "new",
                  values: { role: "one body unit" },
                  explanation: "Blocks give ordinary tools a shared content vocabulary.",
                },
              ],
            },
            {
              id: "questions",
              title: "Questions",
              purpose: "Resolve facts that can alter the form.",
              kind: "questions",
              items: [
                {
                  id: "capability",
                  question: "Can the renderer preserve syntax-aware diffs?",
                  resolutionMethod: "investigate-code",
                  effect: "The answer changes the viable option.",
                },
                {
                  id: "recursion",
                  question: "Does nested rendering remain stable?",
                  resolutionMethod: "run-experiment",
                  resolution: "Yes.",
                },
              ],
            },
          ],
        },
        {
          id: "corpus",
          title: "Tool corpus",
          purpose: "Compare tool presentation through a finite task vocabulary.",
          kind: "records",
          view: "table",
          provenance: "code",
          subject: "Tool",
          fields: [
            {
              id: "shape",
              label: "Shape",
              kind: "choice",
              cardinality: "one",
              options: [
                { id: "multi", label: "Multi", description: "Two or more blocks." },
                { id: "declared", label: "Declared" },
              ],
            },
            {
              id: "content",
              label: "Block kinds",
              kind: "choice",
              cardinality: "many",
              options: [
                { id: "code", label: "Code" },
                { id: "text", label: "Text" },
                { id: "shared", label: "Shared blocks" },
              ],
            },
          ],
          items: [
            {
              id: "bash",
              subject: "bash",
              change: "existing",
              values: { shape: "multi", content: ["code", "text"] },
              provenance: "BashToolCall.tsx#BashToolCall",
            },
          ],
        },
        {
          id: "decisions",
          title: "Design decisions",
          purpose: "Record human-owned alternatives.",
          kind: "decisions",
          items: [
            {
              id: "shape",
              question: "How should ordinary tools declare their bodies?",
              options: [
                {
                  id: "declaration",
                  label: "Use declared blocks",
                  adds: [
                    {
                      sectionId: "corpus",
                      id: "ordinary",
                      subject: "ordinary tools",
                      change: "new",
                      values: { shape: "declared", content: ["shared"] },
                      explanation: "This makes the shared path explicit.",
                    },
                  ],
                },
                {
                  id: "defer",
                  label: "Defer the shared model",
                  rationale: "The selected label remains part of the approved intent.",
                  adds: [],
                },
              ],
              chosen: "declaration",
              status: "provisional",
              blocking: true,
              dependsOn: [],
            },
          ],
        },
        {
          id: "exact-handoff",
          title: "Exact handoff",
          purpose: "Keep syntax and ordered rollout detail beside the intent.",
          kind: "exhibits",
          provenance: "optional",
          items: [
            {
              id: "declaration",
              title: "Declared body",
              kind: "code",
              change: "new",
              description: "Use the **shared body** vocabulary.",
              language: "typescript",
              content: 'const body = {\n  kind: "text",\n  value: result,\n};\n',
            },
            {
              id: "rollout",
              title: "Safe rollout",
              kind: "procedure",
              change: "modified",
              description: "Move one renderer at a time.",
              provenance: "ToolCallMessage.tsx#ToolCallMessage",
              steps: [
                {
                  id: "declare",
                  instruction: "Declare one **ordinary tool** body.",
                  code: {
                    language: "typescript",
                    content: "const body = renderToolBody(call);",
                  },
                },
                {
                  id: "compare",
                  instruction: "Compare the resulting transcript.",
                },
              ],
            },
            {
              id: "rendering-path",
              title: "Shared rendering path",
              kind: "image",
              change: "new",
              uri: "./images/rendering-path.svg",
            },
            {
              id: "rendering-prototype",
              title: "Rendering prototype",
              kind: "html",
              change: "new",
              uri: "./prototype/index.html",
            },
            {
              id: "embedded-rendering-prototype",
              title: "Embedded rendering prototype",
              kind: "html",
              change: "new",
              content:
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>',
            },
          ],
        },
        {
          id: "non-goals",
          title: "Non-goals",
          purpose: "Close adjacent scope.",
          kind: "list",
          style: "bullet",
          items: ["Changing **which tools** appear."],
        },
        {
          id: "empty",
          title: "Unmapped area",
          purpose: "Reserve a records section populated only by future options.",
          kind: "records",
          view: "cards",
          provenance: "optional",
          subject: "Subject",
          fields: [],
          items: [],
        },
      ],
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function section(definition: IntentDefinition, id: string): IntentSection {
  for (const candidate of definition.sections) {
    if (candidate.id === id) return candidate;
    if (candidate.kind === "group") {
      const child = candidate.sections.find((item) => item.id === id);
      if (child) return child;
    }
  }
  throw new Error(`Missing section ${id}`);
}

function renderSection(definition: IntentDefinition, id: string): string {
  const selected = section(definition, id);
  if (selected.kind === "map") throw new Error("Map sections use their visualization renderer");
  return renderToStaticMarkup(
    <IntentSectionContent
      definition={definition}
      section={selected}
      editable
      baseUri="https://toybox.test/api/serve/session/specs/"
      pending={new Set()}
      renderSequence={() => null}
      onInspect={() => {}}
      onRefresh={() => {}}
      onExplain={() => {}}
      onRemove={() => {}}
      onUndoRemoval={() => {}}
      onInvestigate={() => {}}
      onChoose={() => {}}
      onRecord={() => {}}
      onReopenDecision={() => {}}
      onClear={() => {}}
      onReopenQuestion={() => {}}
      onRecordsViewChange={() => {}}
    />,
  );
}

test("renders document-like section headings and disclosure state", () => {
  const expanded = renderToStaticMarkup(
    <SectionPanel
      title="Tool corpus"
      purpose="Compare the tools that use the shared rendering path."
      count={3}
      open
      refresh={{ busy: false, onClick: () => {} }}
      onOpenChange={() => {}}
    >
      <p>Rows</p>
    </SectionPanel>,
  );
  const collapsed = renderToStaticMarkup(
    <SectionPanel
      title="Narrative"
      purpose="Explain the direction without prescribing a template."
      count={1}
      open={false}
      onOpenChange={() => {}}
    >
      <p>Body</p>
    </SectionPanel>,
  );

  expect(expanded).toContain('aria-expanded="true"');
  expect(expanded).toContain('aria-label="3 items"');
  expect(expanded).toContain(">Tool corpus</span>");
  expect(expanded).toContain(
    'aria-label="About Tool corpus: Compare the tools that use the shared rendering path."',
  );
  expect(expanded).not.toContain(">to deliver</span>");
  expect(expanded).toContain('aria-label="Refresh Tool corpus"');
  expect(expanded).toContain('data-orientation="vertical"');
  expect(collapsed).toContain('aria-expanded="false"');
  expect(collapsed).not.toContain(">background</span>");
  expect(collapsed).toContain(" hidden=");
});

test("renders prose and list sections from their authored form", () => {
  const definition = fixture();
  const prose = renderSection(definition, "overview");
  const list = renderSection(definition, "non-goals");

  expect(prose).not.toContain("Explain the direction.");
  expect(prose).toContain('data-streamdown="strong">context</span>');
  expect(prose).toContain("<code");
  expect(prose).toContain(">clientId</code>");
  expect(prose).toContain('data-streamdown="link"');
  expect(prose).toContain(">structured changes</button>");
  expect(prose).toContain("<ul");
  expect(prose).toContain("The reading remains cohesive.");
  expect(prose).not.toContain("**");
  expect(prose).not.toContain("`clientId`");
  expect(list).not.toContain("Close adjacent scope.");
  expect(list).toContain("list-disc");
  expect(list).toContain("<strong>which tools</strong>");
});

test("renders exact, URI-backed, and embedded exhibits without flattening their content", () => {
  const markup = renderSection(fixture(), "exact-handoff");

  expect(markup).not.toContain("Keep syntax and ordered rollout detail");
  expect(markup).not.toContain(">Exact code</span>");
  expect(markup).not.toContain(">Procedure</span>");
  expect(markup).toContain("<strong>shared body</strong>");
  expect(markup).toContain('data-language="typescript"');
  expect(markup).toContain('aria-label="Copy Declared body"');
  expect(markup).toContain("const body = {\n  kind: &quot;text&quot;,\n  value: result,\n};\n");
  expect(markup).toContain("Declare one <strong>ordinary tool</strong> body.");
  expect(markup).toContain('aria-label="Copy Safe rollout, step 1"');
  expect(markup).toContain("ToolCallMessage.tsx#ToolCallMessage");
  expect(markup).toContain('aria-label="Changing. Source: ToolCallMessage.tsx#ToolCallMessage"');
  expect(markup).not.toContain('aria-label="Show source"');
  expect(markup).toContain('aria-label="Inspect Declared body"');
  expect(markup).toContain(
    'src="https://toybox.test/api/serve/session/specs/images/rendering-path.svg"',
  );
  expect(markup).toContain('alt="Shared rendering path"');
  expect(markup).toContain(
    'src="https://toybox.test/api/serve/session/specs/prototype/index.html"',
  );
  expect(markup).toContain('title="Rendering prototype"');
  expect(markup).toMatch(/src[Dd]oc="&lt;head&gt;/);
  expect(markup).toContain("data-toybox-file-base");
  expect(markup).toContain("&lt;svg xmlns=&quot;http://www.w3.org/2000/svg&quot;");
  expect(markup).toContain('title="Embedded rendering prototype"');
  expect(markup).toContain(
    'sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-top-navigation-by-user-activation"',
  );
});

test("renders grouped subsections in authored columns without refreshing workflow state", () => {
  const markup = renderSection(fixture(), "domain");

  expect(markup).not.toContain("Show a column-oriented group");
  expect(markup).toContain("md:grid-cols-2");
  expect(markup).not.toContain("sm:grid-cols-2");
  expect(markup).toContain(">Concepts</h3>");
  expect(markup).toContain(">Questions</h3>");
  expect(markup).toContain('aria-label="About Concepts: Name changed concepts."');
  expect(markup).toContain('aria-label="About Questions: Resolve facts that can alter the form."');
  expect(markup).toContain('aria-label="Refresh Concepts"');
  expect(markup).not.toContain('aria-label="Refresh Questions"');
  expect(markup).toContain('data-orientation="vertical"');
  expect(markup).not.toContain(">to deliver</span>");
  expect(buttonTag(markup, "Show Concepts as a table")).toContain('aria-pressed="false"');
  expect(buttonTag(markup, "Show Concepts as cards")).toContain('aria-pressed="true"');
});

test("renders directly inspectable table records with semantic choice chips", () => {
  const markup = renderSection(fixture(), "corpus");

  expect(markup).toContain(">Tool</th>");
  expect(markup).toContain("overflow-x-auto");
  expect(markup).not.toContain("md:hidden");
  expect(buttonTag(markup, "Show Tool corpus as a table")).toContain('aria-pressed="true"');
  expect(buttonTag(markup, "Show Tool corpus as cards")).toContain('aria-pressed="false"');
  expect(markup).toContain(">Shape</th>");
  expect(markup).toContain(">Block kinds</th>");
  expect(markup).toContain(">Multi</span>");
  expect(markup).toContain('title="Two or more blocks."');
  expect(markup).toContain('aria-label="Multi: Two or more blocks."');
  expect(markup).toContain("Shape:");
  expect(markup).not.toContain(">Block kinds:</span>");
  expect(markup).toContain(">Trying</span>");
  expect(markup).toContain('aria-label="Trying addition from option Use declared blocks"');
  expect(markup).toContain("Use declared blocks");
  expect(markup).toContain("bg-violet-500/5");
  expect(markup).toContain("BashToolCall.tsx#BashToolCall");
  expect(markup).toContain(">Already here</span>");
  expect(markup).toContain('aria-label="Already here. Source: BashToolCall.tsx#BashToolCall"');
  expect(markup).not.toContain('aria-label="Show source"');
  expect(markup).toContain("<summary");
  expect(markup).toContain("What these labels mean");
  expect(markup).not.toContain(">Provenance</th>");
  expect(markup).toContain('aria-label="Inspect bash"');
  expect(markup).toContain('tabindex="0"');
  expect(markup).not.toContain('title="Inspect bash"');
  expect(markup).not.toContain('aria-label="Show explanation for bash"');
  expect(markup).not.toContain("This makes the shared path explicit.");
  expect(markup).not.toContain(">declared<");
  expect(markup).not.toContain(">shared<");
});

test("renders card records with direct inspection, provenance, removal, and undo", () => {
  const definition = fixture();
  const domain = section(definition, "domain");
  if (domain.kind !== "group") throw new Error("Expected group");
  const concepts = domain.sections[0]!;
  const markup = renderToStaticMarkup(
    <IntentSectionContent
      definition={definition}
      section={concepts}
      editable
      pending={new Set()}
      renderSequence={() => null}
      undoRemoval={{ sectionId: "concepts", label: "Block" }}
      onExplain={() => {}}
      onRemove={() => {}}
      onUndoRemoval={() => {}}
      onChoose={() => {}}
      onRecord={() => {}}
      onReopenDecision={() => {}}
      onClear={() => {}}
      onReopenQuestion={() => {}}
      onInspect={() => {}}
      onRecordsViewChange={() => {}}
    />,
  );

  expect(markup).toContain("sm:grid-cols-2");
  expect(markup).toContain("Block");
  expect(markup).toContain('aria-label="Inspect Block"');
  expect(markup).toContain('tabindex="0"');
  expect(markup).toContain(">New</span>");
  expect(markup).toContain("one body unit");
  expect(markup).not.toContain(">Role</dt>");
  expect(markup).not.toContain("Blocks give ordinary tools a shared content vocabulary.");
  expect(markup).not.toContain('aria-label="Show explanation for Block"');
  expect(markup).toContain('aria-label="Remove Block from intent"');
  expect(markup).toContain('role="status"');
  expect(markup).toContain("Removed Block from intent.");
});

test("turns one choice and one text field into a readable compact card", () => {
  const definition = fixture();
  definition.sections.push({
    id: "copy-rules",
    title: "What the copy keeps",
    purpose: "Compare the small copy vocabulary.",
    kind: "records",
    collapsed: false,
    view: "table",
    provenance: "optional",
    subject: "Part",
    fields: [
      {
        id: "handling",
        label: "Do this",
        kind: "choice",
        cardinality: "one",
        options: [
          { id: "copy", label: "Copy" },
          { id: "reset", label: "Start fresh" },
        ],
      },
      { id: "result", label: "What that means", kind: "text" },
    ],
    items: [
      {
        id: "copy-color",
        subject: "Color",
        change: "new",
        values: { handling: "copy", result: "Keep the source color." },
      },
    ],
  });

  const markup = renderSection(definition, "copy-rules");
  expect(markup).toContain(">Copy</span>");
  expect(markup).toContain("Keep the source color.");
  expect(markup).not.toContain(">Do this</dt>");
  expect(markup).not.toContain(">What that means</dt>");
  expect(markup).not.toContain("What these labels mean");
});

test("renders generic decision additions with reader-facing field values", () => {
  const definition = fixture();
  const markup = renderSection(definition, "decisions");

  expect(markup).toContain("What this choice changes in Tool corpus");
  expect(markup).toContain("<details");
  expect(markup).toContain("Tool corpus:");
  expect(markup).toContain("ordinary tools");
  expect(markup).toContain("Shape:");
  expect(markup).toContain("Declared");
  expect(markup).toContain("Block kinds:");
  expect(markup).toContain("Shared blocks");
  expect(markup).not.toContain(">declared<");
  expect(markup).not.toContain(">shared<");
  expect(markup).toContain("Defer the shared model");
});

test("renders factual question workflows independently of form placement", () => {
  const markup = renderSection(fixture(), "questions");

  expect(markup).toContain("Check the code");
  expect(markup).toContain(">Try it</span>");
  expect(markup).toContain("Check code");
  expect(markup).toContain("Yes.");
  expect(markup).toContain("Revisit question");
});

test("renders an actionable empty records state", () => {
  expect(renderSection(fixture(), "empty")).toContain("No records mapped yet.");
});

function buttonTag(markup: string, accessibleLabel: string): string {
  const labelIndex = markup.indexOf(`aria-label="${accessibleLabel}"`);
  expect(labelIndex).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<button", labelIndex);
  return markup.slice(start, markup.indexOf(">", labelIndex) + 1);
}
