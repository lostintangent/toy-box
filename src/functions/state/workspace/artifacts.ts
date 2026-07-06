// Disk-backed storage for user-registered custom artifact kinds.
//
// Each kind is a folder under `~/.toy-box/artifacts/<name>/` holding its metadata
// (`artifact.json`) and its viewer template (`index.html`). The folder — not a
// database — is the source of truth, so a kind is inspectable, editable, and
// removable as plain files, and the disk is the only place that needs to persist.
// `loadCustomArtifacts` feeds workspace state on every hydration; the SDK
// `register_artifact_kind` tool is the sole writer.

import { homedir } from "node:os";
import { join } from "node:path";
import type { CustomArtifactKind } from "@/types";

const ARTIFACTS_ROOT_SEGMENTS = [".toy-box", "artifacts"];
const METADATA_FILE = "artifact.json";
const TEMPLATE_FILE = "index.html";

/** Folder + metadata id must be a safe single path segment (no traversal, no separators). */
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;

function artifactsRoot(): string {
  return join(homedir(), ...ARTIFACTS_ROOT_SEGMENTS);
}

function artifactDirectory(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`Invalid artifact kind name: ${name}`);
  return join(artifactsRoot(), name);
}

/** Read every registered kind. Missing or malformed folders are skipped, never fatal. */
export async function loadCustomArtifacts(): Promise<CustomArtifactKind[]> {
  const { readdir } = await import("node:fs/promises");

  let entries;
  try {
    entries = await readdir(artifactsRoot(), { withFileTypes: true });
  } catch {
    // The artifacts folder doesn't exist yet — no custom kinds registered.
    return [];
  }

  const kinds = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SAFE_NAME.test(entry.name))
      .map((entry) => readCustomArtifact(entry.name)),
  );

  return kinds.filter((kind): kind is CustomArtifactKind => kind !== null);
}

/** Write (or overwrite) a kind's folder. The name is validated as a safe path segment. */
export async function writeCustomArtifact(kind: CustomArtifactKind): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const directory = artifactDirectory(kind.name);
  await mkdir(directory, { recursive: true });

  const metadata = {
    extensions: kind.extensions,
    icon: kind.icon,
    editable: kind.editable ?? false,
  };

  await Promise.all([
    writeFile(join(directory, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, "utf-8"),
    writeFile(join(directory, TEMPLATE_FILE), kind.html, "utf-8"),
  ]);
}

async function readCustomArtifact(name: string): Promise<CustomArtifactKind | null> {
  const { readFile } = await import("node:fs/promises");
  const directory = join(artifactsRoot(), name);

  try {
    const [rawMetadata, html] = await Promise.all([
      readFile(join(directory, METADATA_FILE), "utf-8"),
      readFile(join(directory, TEMPLATE_FILE), "utf-8"),
    ]);
    return parseCustomArtifact(name, rawMetadata, html);
  } catch {
    return null;
  }
}

function parseCustomArtifact(
  name: string,
  rawMetadata: string,
  html: string,
): CustomArtifactKind | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
