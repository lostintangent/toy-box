import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { normalizeExtensions, registerEditorKind } from "@/functions/state/workspace";

const registerEditorKindTool = defineTool("register_editor", {
  description:
    "Registers or replaces a custom editor for the supplied file extensions. Follow the loaded `create-toy-box-editor` skill for its HTML bridge contract.",
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
    html: z.string().min(1).describe("Complete standalone index.html document."),
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

    await registerEditorKind(kind);

    return JSON.stringify({
      registered: kind.name,
      extensions: kind.extensions,
      note: "Matching files now use this kind.",
    });
  },
});

export const editorTools = [registerEditorKindTool];
