// Disk-backed storage for user-registered custom editors.
//
// Each editor is a folder under `~/.toy-box/editors/<name>/` holding its metadata
// (`editor.json`) and its viewer template (`index.html`). The folder — not a
// database — is the source of truth, so an editor is inspectable, editable, and
// removable as plain files, and the disk is the only place that needs to persist.
// `loadCustomEditors` feeds workspace state on every hydration; the SDK
// `register_editor` tool is the sole writer.

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CustomEditorKind } from "@/types";

const METADATA_FILE = "editor.json";
const TEMPLATE_FILE = "index.html";

/** Folder + metadata id must be a safe single path segment (no traversal, no separators). */
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

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
      .filter((entry) => entry.isDirectory() && SAFE_NAME.test(entry.name))
      .map((entry) => readCustomEditor(entry.name)),
  );

  return kinds.filter((kind): kind is CustomEditorKind => kind !== null);
}

/** Write (or overwrite) an editor's folder. The name is validated as a safe path segment. */
export async function writeCustomEditor(kind: CustomEditorKind): Promise<void> {
  const directory = editorDirectory(kind.name);

  const metadata = {
    extensions: kind.extensions,
    icon: kind.icon,
    editable: kind.editable ?? false,
  };

  await Promise.all([
    Bun.write(join(directory, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`),
    Bun.write(join(directory, TEMPLATE_FILE), kind.html),
  ]);
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

function editorDirectory(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`Invalid editor name: ${name}`);
  return join(editorsRoot(), name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
