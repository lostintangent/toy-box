import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { normalizeExtensions, registerArtifactKind } from "@/functions/state/workspace";

// The contract a template must follow, embedded in the tool description so the model
// only reads it when actually registering a kind (rather than paying for it in every
// session's system prompt).
const TEMPLATE_CONTRACT = [
  "The `html` is a complete, standalone HTML document that renders the FILE CONTENT it is given.",
  "It runs sandboxed in an iframe and talks to Toy Box through a `window.Toybox` global (already injected — do not define it):",
  "  • `Toybox.onRender((content, { editable, pendingWorkers }) => { ... })` — register a callback that draws `content` (the raw file text, e.g. the JSON string) and any pending background UI into the DOM. Each pending worker has `{ sessionId, name?, metadata? }`. It fires on first load and whenever content or pending workers change, so make it idempotent (rebuild from current inputs, don't append).",
  "  • `Toybox.emitChange(nextContent)` — call this to persist an in-view edit back to the file. Only wire this up when `editable` is true.",
  "  • `await Toybox.spawnWorker({ name?, prompt, metadata? })` — spawn a disposable worker for this artifact. The optional friendly name appears in Toy Box's worker UI; the prompt defines the artifact-specific work; JSON metadata is returned unchanged in `pendingWorkers`, allowing responsive spinners or placeholders.",
  "Guidelines: call `Toybox.spawnWorker` only from a direct user action; derive pending UI from `pendingWorkers`; remember that a worker can update durable content before it finishes, so encode a target identity or baseline in metadata and suppress placeholders once content proves their result is visible; inline all CSS/JS (no local file references); handle malformed content gracefully; keep the whole viewer self-contained. Do not add a file watcher, fetch the file, or read query params — content and worker state always arrive via `onRender`.",
].join("\n");

const registerArtifactKindTool = defineTool("register_artifact_kind", {
  description:
    "Registers a custom artifact viewer ('kind') so that files with the given extension(s) open in a bespoke rendered view inside Toy Box, instead of the default Markdown/HTML handling. " +
    "Use this when the user asks to create or customize how a file type is displayed (e.g. 'render JSON files as a collapsible tree'). " +
    "The viewer is a self-contained HTML/JS template you author. It is saved under ~/.toy-box/artifacts/<name>/ and applies to every session.\n\n" +
    TEMPLATE_CONTRACT,
  parameters: z.object({
    name: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9][a-z0-9-]*$/,
        "Lowercase letters, digits, and hyphens only (used as the folder name and id).",
      )
      .max(64)
      .describe("Unique id / folder name for the kind, e.g. 'json-tree'."),
    extensions: z
      .array(z.string().trim().min(1))
      .min(1)
      .describe("File extensions this kind claims, without the dot, e.g. ['json']."),
    html: z
      .string()
      .min(1)
      .describe("The complete standalone index.html template (see the contract above)."),
    icon: z
      .string()
      .trim()
      .optional()
      .describe(
        "Optional icon name: braces, json, code, table, list, database, image, chart, text, file.",
      ),
    editable: z
      .boolean()
      .optional()
      .describe("Whether the viewer can write edits back to the file (default false)."),
  }),
  skipPermission: true,
  handler: async (input) => {
    const extensions = normalizeExtensions(input.extensions);
    if (extensions.length === 0) {
      throw new Error("At least one valid file extension is required.");
    }

    const kind = {
      name: input.name,
      extensions,
      icon: input.icon,
      editable: input.editable ?? false,
      html: input.html,
    };

    await registerArtifactKind(kind);

    return JSON.stringify({
      registered: kind.name,
      extensions: kind.extensions,
      note: "Matching files now use this kind.",
    });
  },
});

export const artifactKindTools = [registerArtifactKindTool];
