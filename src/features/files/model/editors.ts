import { z } from "zod";

export const customEditorNameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Lowercase letters, digits, and hyphens only (used as the folder name and id).",
  )
  .max(64);

export const customEditorKindSchema = z.object({
  name: customEditorNameSchema.describe("Unique id / folder name, e.g. 'json-tree'."),
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
});

export type CustomEditorKind = z.infer<typeof customEditorKindSchema>;
