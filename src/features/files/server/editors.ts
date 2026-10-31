// Disk-backed storage for user-registered custom editors.
//
// Each editor is a folder under `~/.toy-box/editors/<name>/` holding its metadata
// (`editor.json`) and its viewer template (`index.html`). The folder — not a
// database — is the source of truth, so an editor is inspectable, editable, and
// removable as plain files, and the disk is the only place that needs to persist.
// `loadCustomEditors` backs the editors query, and `registerEditorKind`, called by
// the `register_editor` tool, is the sole writer.

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { broadcast } from "@workspace/server/events";
import { customEditorNameSchema, type CustomEditorKind } from "../model";

const METADATA_FILE = "editor.json";
const TEMPLATE_FILE = "index.html";

/** Read every registered editor. Missing or malformed folders are skipped, never fatal. */
export async function loadCustomEditors(): Promise<CustomEditorKind[]> {
  let entries;
  try {
    entries = await readdir(editorsRoot(), { withFileTypes: true });
  } catch {
    // The editors folder doesn't exist yet — no custom editors registered.
    return [];
  }

  const kinds = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isCanonicalEditorName(entry.name))
      .map((entry) => readCustomEditor(entry.name)),
  );

  return kinds.filter((kind): kind is CustomEditorKind => kind !== null);
}

/** Write (or overwrite) an editor's folder, announce it, and return the normalized kind. */
export async function registerEditorKind(input: CustomEditorKind): Promise<CustomEditorKind> {
  const extensions = normalizeExtensions(input.extensions);
  if (extensions.length === 0) {
    throw new Error("At least one valid file extension is required.");
  }

  const kind = { ...input, extensions, editable: input.editable ?? false };
  const directory = join(editorsRoot(), kind.name);
  const metadata = { extensions, icon: kind.icon, editable: kind.editable };
  await Promise.all([
    Bun.write(join(directory, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`),
    Bun.write(join(directory, TEMPLATE_FILE), kind.html),
  ]);

  broadcast({ type: "editor.registered", kind });
  return kind;
}

/** Bare, lowercased, de-duplicated extensions (a leading dot is tolerated and stripped). */
export function normalizeExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const extension = entry.trim().replace(/^\.+/, "").toLowerCase();
    if (extension) seen.add(extension);
  }
  return Array.from(seen);
}

async function readCustomEditor(name: string): Promise<CustomEditorKind | null> {
  const directory = join(editorsRoot(), name);

  try {
    const [rawMetadata, html] = await Promise.all([
      Bun.file(join(directory, METADATA_FILE)).text(),
      Bun.file(join(directory, TEMPLATE_FILE)).text(),
    ]);
    return parseCustomEditor(name, rawMetadata, html);
  } catch {
    return null;
  }
}

function parseCustomEditor(
  name: string,
  rawMetadata: string,
  html: string,
): CustomEditorKind | null {
  let metadata: unknown;
  try {
    metadata = JSON.parse(rawMetadata);
  } catch {
    return null;
  }
  if (!isRecord(metadata)) return null;

  const extensions = normalizeExtensions(metadata.extensions);
  if (extensions.length === 0) return null;

  return {
    name,
    extensions,
    icon: typeof metadata.icon === "string" ? metadata.icon : undefined,
    editable: metadata.editable === true,
    html,
  };
}

function editorsRoot(): string {
  return join(homedir(), ".toy-box", "editors");
}

function isCanonicalEditorName(name: string): boolean {
  const result = customEditorNameSchema.safeParse(name);
  return result.success && result.data === name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
