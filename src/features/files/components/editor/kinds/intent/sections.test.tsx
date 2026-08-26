import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseIntent, type IntentDocument, type IntentSection } from "./model/index";
import { IntentSectionContent, SectionPanel } from "./sections";

function fixture(): IntentDocument {
  const parsed = parseIntent(
    JSON.stringify({
      title: "Flexible intent",
      sections: [
        {
          id: "overview",
          title: "Markdown",
          purpose: "Explain the direction.",
          kind: "markdown",
          body: "This document keeps **context** beside `clientId` and the [structured changes](https://example.com/changes).\n\n- The reading remains cohesive.",
        },
        {
          id: "findings",
          title: "What the code says",
          purpose: "Preserve only discoveries that shape the spec.",
          kind: "findings",
          sourcePolicy: "code",
          items: [
            {
              id: "shared-frame-finding",
              statement: "ToolCallMessage already owns the common frame and lifecycle.",
              whyItMatters: "A shared body can reuse **one owner** instead of adding another.",
              sources: [
                "src/features/sessions/ToolCallMessage.tsx#ToolCallMessage",
                "src/features/sessions/DefaultToolCall.tsx#DefaultToolCall",
              ],
              exhibit: {
                id: "current-ownership",
                title: "Current ownership",
                kind: "tree",
                type: "domain",
                change: "existing",
                roots: [
                  {
                    name: "ToolCallMessage",
                    children: [{ name: "Frame" }, { name: "Lifecycle" }],
                  },
                ],
              },
            },
          ],
        },
        {
          id: "concepts",
          title: "Concepts",
          purpose: "Name changed concepts.",
          kind: "records",
          view: "cards",
          sourcePolicy: "code",
          subject: "Concept",
          fields: [{ id: "role", label: "Role", kind: "text" }],
          items: [
            {
              id: "block",
              subject: "Block",
              change: "new",
              values: { role: "one body unit" },
              explanation: "Blocks give ordinary tools a shared content vocabulary.",
              basedOn: ["shared-frame-finding"],
            },
          ],
        },
        {
          id: "questions",
          title: "Questions",
          purpose: "Resolve facts that can alter the document.",
          kind: "questions",
          items: [
            {
              id: "capability",
              question: "Can the renderer preserve syntax-aware diffs?",
              answerMethod: "investigate-code",
              impact: "The answer changes the viable option.",
            },
            {
              id: "recursion",
              question: "Does nested rendering remain stable?",
              answerMethod: "run-experiment",
              answer: "Yes.",
            },
          ],
        },
        {
          id: "corpus",
          title: "Tool corpus",
          purpose: "Compare tool presentation through a finite task vocabulary.",
          kind: "records",
          view: "table",
          sourcePolicy: "code",
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
              source: "BashToolCall.tsx#BashToolCall",
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
                  rationale: "The selected label remains part of the settled spec.",
                  adds: [],
                },
              ],
              choice: { optionId: "declaration", status: "provisional" },
              dependsOn: [],
            },
          ],
        },
        {
          id: "technical-definitions",
          title: "Technical definitions",
          purpose: "Keep pseudocode contracts and structured exhibits beside the intent.",
          kind: "exhibits",
          sourcePolicy: "optional",
          items: [
            {
              id: "declaration",
              title: "Declared body",
              kind: "pseudocode",
              change: "new",
              description: "Use the **shared body** [vocabulary](https://example.com/shared-body).",
              language: "typescript",
              content: 'const body = {\n  kind: "text",\n  value: result,\n};\n',
            },
            {
              id: "rollout",
              title: "Safe comparison",
              kind: "pseudocode",
              change: "modified",
              description: "Compare one *ordinary tool* with its existing renderer.",
              source: "ToolCallMessage.tsx#ToolCallMessage",
              language: "typescript",
              content: "assertEquivalent(renderToolBody(call), renderBespokeBody(call));",
            },
            {
              id: "resulting-files",
              title: "Resulting file structure",
              kind: "tree",
              type: "files",
              change: "modified",
              description: "Show the required target ownership as a file tree.",
              roots: [
                {
                  kind: "folder",
                  name: "src/features/files",
                  change: "modified",
                  children: [
                    {
                      kind: "folder",
                      name: "renderers",
                      change: "new",
                      children: [
                        { kind: "file", name: "FileTree.tsx", change: "new" },
                        { kind: "file", name: "legacy.ts", change: "removed" },
                      ],
                    },
                    { kind: "file", name: "IntentEditor.tsx", change: "modified" },
                  ],
                },
                {
                  kind: "folder",
                  name: "tests",
                  children: [{ kind: "file", name: "file-tree.test.tsx", change: "new" }],
                },
              ],
            },
            {
              id: "intent-domain",
              title: "Intent document domain",
              kind: "tree",
              type: "domain",
              change: "new",
              description:
                "Lock in the conceptual hierarchy without turning its nodes into intent entities.",
              roots: [
                {
                  name: "Intent document",
                  children: [
                    {
                      name: "Spec",
                      change: "modified",
                      children: [
                        { name: "Description" },
                        { name: "Definition", change: "new" },
                        { name: "Resolution" },
                      ],
                    },
                    {
                      name: "Plan",
                      children: [{ name: "Phases" }, { name: "Steps" }],
                    },
                  ],
                },
              ],
            },
            {
              id: "rendering-path",
              title: "Shared rendering path",
              kind: "image",
              change: "new",
              uri: "./images/rendering-path.svg",
              altText: "Ordinary tool calls converging on the shared rendering path.",
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
          items: [
            "Changing *which tools* appear through [configuration](https://example.com/configuration).",
          ],
        },
        {
          id: "empty",
          title: "Unmapped area",
          purpose: "Reserve a records section populated only by future options.",
          kind: "records",
          view: "cards",
          sourcePolicy: "optional",
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

function section(document: IntentDocument, id: string): IntentSection {
  const section = document.sections.find((candidate) => candidate.id === id);
  if (section) return section;
  throw new Error(`Missing section ${id}`);
}

function renderSection(document: IntentDocument, id: string): string {
  const selected = section(document, id);
  return renderToStaticMarkup(
    <IntentSectionContent
      document={document}
      section={selected}
      editable
      baseUri="https://toybox.test/api/serve/session/specs/"
      pending={new Set()}
      renderPlan={() => null}
      onInspect={() => {}}
      onExplainRecord={() => {}}
      onRemoveRecord={() => {}}
      onInvestigateQuestion={() => {}}
      onSelectDecisionOption={() => {}}
      onRecordDecision={() => {}}
      onReopenDecision={() => {}}
      onClearDecisionChoice={() => {}}
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
      actions={{
        regenerate: { busy: false, onSelect: () => {} },
        onDelete: () => {},
      }}
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
      actions={{ onDelete: () => {} }}
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
  expect(expanded).toContain('aria-label="Actions for Tool corpus"');
  expect(collapsed).toContain('aria-expanded="false"');
  expect(collapsed).toContain('aria-label="Actions for Narrative"');
  expect(collapsed).toContain(" hidden=");
});

test("renders markdown and list sections from their authored shapes", () => {
  const document = fixture();
  const markdown = renderSection(document, "overview");
  const list = renderSection(document, "non-goals");

  expect(markdown).not.toContain("Explain the direction.");
  expect(markdown).toContain('data-streamdown="strong">context</span>');
  expect(markdown).toContain("<code");
  expect(markdown).toContain(">clientId</code>");
  expect(markdown).toContain('data-streamdown="link"');
  expect(markdown).toContain(">structured changes</button>");
  expect(markdown).toContain("<ul");
  expect(markdown).toContain("The reading remains cohesive.");
  expect(markdown).not.toContain("**");
  expect(markdown).not.toContain("`clientId`");
  expect(list).not.toContain("Close adjacent scope.");
  expect(list).toContain("list-disc");
  expect(list).toContain("<em>which tools</em>");
  expect(list).toContain('data-streamdown="link"');
  expect(list).toContain(">configuration</button>");
});

test("renders compact finding statements with evidence available on demand", () => {
  const markup = renderSection(fixture(), "findings");

  expect(markup).toContain("ToolCallMessage already owns the common frame and lifecycle.");
  expect(markup).not.toContain("Finding 1");
  expect(markup).toContain("<details");
  expect(markup).not.toContain("<details open");
  expect(markup).toContain("Why and evidence");
  expect(markup.indexOf("ToolCallMessage already owns")).toBeLessThan(markup.indexOf("<details"));
  expect(markup).toContain("Why it matters");
  expect(markup).toContain('data-streamdown="strong">one owner</span>');
  expect(markup).toContain(">Current ownership</h4>");
  expect(markup).toContain('aria-label="Domain trees"');
  expect(markup).toContain('title="src/features/sessions/ToolCallMessage.tsx#ToolCallMessage"');
  expect(markup).toContain(">ToolCallMessage.tsx#ToolCallMessage</span>");
  expect(markup).toContain(">Grounds Block</span>");
  expect(markup).toContain(
    'aria-label="Inspect finding: ToolCallMessage already owns the common frame and lifecycle."',
  );
  expect(markup).not.toContain("Already here");
});

test("renders pseudocode, tree, URI-backed, and embedded exhibits without flattening them", () => {
  const markup = renderSection(fixture(), "technical-definitions");

  expect(markup).not.toContain("Keep syntax and ordered rollout detail");
  expect(markup).toContain('<span class="sr-only">Pseudocode</span>');
  expect(markup).toContain('data-streamdown="strong">shared body</span>');
  expect(markup).toContain('data-streamdown="link"');
  expect(markup).toContain(">vocabulary</button>");
  expect(markup).toContain('data-language="typescript"');
  expect(markup).toContain('aria-label="Copy Declared body"');
  expect(markup).toContain("const body = {\n  kind: &quot;text&quot;,\n  value: result,\n};\n");
  expect(markup).toContain("<em>ordinary tool</em>");
  expect(markup).toContain('aria-label="Copy Safe comparison"');
  expect(markup).toContain("ToolCallMessage.tsx#ToolCallMessage");
  expect(markup).toContain('aria-label="Changing. Source: ToolCallMessage.tsx#ToolCallMessage"');
  expect(markup).not.toContain('aria-label="Show source"');
  expect(markup).toContain('aria-label="Inspect Declared body"');
  expect(markup).toContain('aria-label="File trees"');
  expect(markup).toContain(">Resulting file structure</h4>");
  expect(markup).toContain(">src/features/files</span>");
  expect(markup).toContain(">renderers</span>");
  expect(markup).toContain(">FileTree.tsx</span>");
  expect(markup).toContain(">legacy.ts</span>");
  expect(markup).toContain(">tests</span>");
  expect(markup).toContain('bg-emerald-500/10 text-emerald-400">Added</span>');
  expect(markup).toContain('bg-amber-500/10 text-amber-400">Modified</span>');
  expect(markup).toContain('bg-rose-500/10 text-rose-400">Deleted</span>');
  expect(markup).toContain('aria-label="Domain trees"');
  expect(markup).toContain(">Intent document</span>");
  expect(markup).toContain(">Definition</span>");
  expect(markup).toContain(
    'src="https://toybox.test/api/serve/session/specs/images/rendering-path.svg"',
  );
  expect(markup).toContain('alt="Ordinary tool calls converging on the shared rendering path."');
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
  expect(markup).not.toContain(">Source</th>");
  expect(markup).toContain('aria-label="Inspect bash"');
  expect(markup).toContain('tabindex="0"');
  expect(markup).not.toContain('title="Inspect bash"');
  expect(markup).not.toContain('aria-label="Show explanation for bash"');
  expect(markup).not.toContain("This makes the shared path explicit.");
  expect(markup).not.toContain(">declared<");
  expect(markup).not.toContain(">shared<");
});

test("renders card records with direct inspection, source, and removal", () => {
  const document = fixture();
  const concepts = section(document, "concepts");
  if (concepts.kind !== "records") throw new Error("Expected records section");
  const markup = renderToStaticMarkup(
    <IntentSectionContent
      document={document}
      section={concepts}
      editable
      pending={new Set()}
      renderPlan={() => null}
      onExplainRecord={() => {}}
      onRemoveRecord={() => {}}
      onSelectDecisionOption={() => {}}
      onRecordDecision={() => {}}
      onReopenDecision={() => {}}
      onClearDecisionChoice={() => {}}
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
});

test("turns one choice and one text field into a readable compact card", () => {
  const document = fixture();
  document.sections.push({
    id: "copy-rules",
    title: "What the copy keeps",
    purpose: "Compare the small copy vocabulary.",
    kind: "records",
    collapsed: false,
    view: "table",
    sourcePolicy: "optional",
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

  const markup = renderSection(document, "copy-rules");
  expect(markup).toContain(">Copy</span>");
  expect(markup).toContain("Keep the source color.");
  expect(markup).not.toContain(">Do this</dt>");
  expect(markup).not.toContain(">What that means</dt>");
  expect(markup).not.toContain("What these labels mean");
});

test("renders generic decision additions with reader-facing field values", () => {
  const document = fixture();
  const markup = renderSection(document, "decisions");

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

test("renders option-owned exhibits beside every alternative before a choice", () => {
  const document = fixture();
  const decisions = section(document, "decisions");
  if (decisions.kind !== "decisions") throw new Error("Expected decisions section");
  const decision = decisions.items[0]!;
  delete decision.choice;
  decision.options[0]!.exhibit = {
    id: "declared-block-preview",
    title: "Declared blocks preview",
    kind: "html",
    change: "new",
    content: '<main aria-label="Declared blocks">Shared content</main>',
  };
  decision.options[1]!.exhibit = {
    id: "deferred-model-preview",
    title: "Deferred model preview",
    kind: "html",
    change: "preserved",
    content: '<main aria-label="Deferred model">Bespoke content</main>',
  };

  const markup = renderSection(document, "decisions");
  expect(markup).toContain('title="Declared blocks preview"');
  expect(markup).toContain('title="Deferred model preview"');
  expect(markup).toContain('aria-label="Inspect Declared blocks preview"');
  expect(markup).toContain('aria-label="Inspect Deferred model preview"');
  expect(markup).toContain("2 things would change in Tool corpus");
  expect(markup).toContain("1 thing would change");
});

test("renders resolution sections independently of section placement", () => {
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
