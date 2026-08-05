// File-backed installed app definitions.
//
// Each definition lives under `~/.toy-box/apps/<id>/` as an inspectable
// manifest and one TSX component. Saved instances live separately in SQLite and
// reference the definition by id.

import type { Dirent } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUILT_IN_APP_DEFINITIONS } from "@/apps/builtins";
import {
  appComponentSourceSchema,
  BUILT_IN_APP_DEFINITION_PREFIX,
  appDefinitionIdSchema,
  appManifestSchema,
  ownerAppDefinitionIdSchema,
} from "@/lib/apps/schema";
import type { CompiledAppBundle } from "@/lib/apps/runtime";
import { appStateDefinitionSchema } from "@/lib/apps/stateSchema";
import type { AppDefinition } from "@/types";

const MANIFEST_FILE = "app.json";
const COMPONENT_FILE = "app.tsx";

type AppDefinitionSource = AppDefinition & { tsx: string };

type UnversionedAppDefinition = Omit<AppDefinitionSource, "revision">;

export type AppDefinitionFiles = { manifest: string; tsx: string };

export type AppDefinitionCandidate = {
  files: AppDefinitionFiles;
  definition: Omit<UnversionedAppDefinition, "id">;
};

export class AppDefinitionRegistry {
  private installedDefinitions?: Promise<Map<string, AppDefinitionSource>>;
  private readonly builtIns: readonly AppDefinitionSource[];
  private readonly bundles = new Map<
    string,
    { revision: string; bundle: Promise<CompiledAppBundle> }
  >();

  constructor(
    private readonly root = defaultAppsRoot(),
    builtIns: readonly UnversionedAppDefinition[] = [],
  ) {
    this.builtIns = builtIns.map(materializeBuiltInDefinition);
  }

  async list(): Promise<AppDefinition[]> {
    const definitions = [...this.builtIns, ...(await this.getInstalledDefinitions()).values()].map(
      definitionFromSource,
    );
    return definitions.sort((left, right) => left.title.localeCompare(right.title));
  }

  async get(definitionId: string): Promise<AppDefinitionSource | null> {
    const id = parseDefinitionId(definitionId);
    const builtIn = this.builtIns.find((definition) => definition.id === id);
    return builtIn ?? (await this.getInstalledDefinitions()).get(id) ?? null;
  }

  async getBundle(definitionId: string, revision: string): Promise<CompiledAppBundle> {
    const source = await this.get(definitionId);
    if (!source) throw new Error(`App definition "${definitionId}" was not found.`);
    if (source.revision !== revision) {
      throw new Error(`App definition "${definitionId}" changed while it was loading.`);
    }

    const cached = this.bundles.get(source.id);
    if (cached?.revision === source.revision) return cached.bundle;

    const { compileAppDefinition } = await import("../compiler");
    const bundle = compileAppDefinition(source);
    this.bundles.set(source.id, { revision: source.revision, bundle });
    try {
      return await bundle;
    } catch (error) {
      if (this.bundles.get(source.id)?.bundle === bundle) this.bundles.delete(source.id);
      throw error;
    }
  }

  /** Validate and activate the current files for one owner-installed definition. */
  async register(definitionId: string): Promise<AppDefinition> {
    const id = parseOwnerDefinitionId(definitionId);

    const installed = await this.getInstalledDefinitions();
    const source = await this.readDiskDefinition(id);
    const cached = this.bundles.get(id);
    if (installed.get(id)?.revision !== source.revision || cached?.revision !== source.revision) {
      const { compileAppDefinition } = await import("../compiler");
      const bundle = await compileAppDefinition(source);
      installed.set(id, source);
      this.bundles.set(id, { revision: source.revision, bundle: Promise.resolve(bundle) });
    }
    return definitionFromSource(source);
  }

  /** Compile one validated owner definition before activating its exact source files. */
  async install(definitionId: string, candidate: AppDefinitionCandidate): Promise<AppDefinition> {
    const id = parseOwnerDefinitionId(definitionId);

    const installed = await this.getInstalledDefinitions();
    if (installed.has(id)) throw new Error(`App definition "${id}" is already installed.`);

    const source = materializeDefinition({ id, ...candidate.definition });
    const { compileAppDefinition } = await import("../compiler");
    const bundle = await compileAppDefinition(source);

    const directory = join(this.root, id);
    await mkdir(this.root, { recursive: true });
    try {
      await mkdir(directory);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new Error(`App definition "${id}" is already installed.`);
      }
      throw error;
    }

    try {
      await Promise.all([
        Bun.write(join(directory, MANIFEST_FILE), candidate.files.manifest),
        Bun.write(join(directory, COMPONENT_FILE), candidate.files.tsx),
      ]);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }

    installed.set(id, source);
    this.bundles.set(id, { revision: source.revision, bundle: Promise.resolve(bundle) });
    return definitionFromSource(source);
  }

  /** Remove one owner-installed definition from disk and the active registry. */
  async uninstall(definitionId: string): Promise<boolean> {
    const id = parseOwnerDefinitionId(definitionId);

    const installed = await this.getInstalledDefinitions();
    try {
      await rm(join(this.root, id), { recursive: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      if (!installed.has(id)) return false;
    }
    installed.delete(id);
    this.bundles.delete(id);
    return true;
  }

  private getInstalledDefinitions(): Promise<Map<string, AppDefinitionSource>> {
    this.installedDefinitions ??= this.readInstalledDefinitions();
    return this.installedDefinitions;
  }

  private async readInstalledDefinitions(): Promise<Map<string, AppDefinitionSource>> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      entries = [];
    }

    const diskDefinitions = await Promise.all(
      entries
        .filter(
          (entry) => entry.isDirectory() && appDefinitionIdSchema.safeParse(entry.name).success,
        )
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          try {
            const id = parseOwnerDefinitionId(entry.name);
            return await this.readDiskDefinition(id);
          } catch (error) {
            console.error(`Skipping invalid app definition "${entry.name}":`, error);
            return null;
          }
        }),
    );

    return new Map(
      diskDefinitions
        .filter((definition): definition is AppDefinitionSource => definition !== null)
        .map((definition) => [definition.id, definition]),
    );
  }

  private async readDiskDefinition(id: string): Promise<AppDefinitionSource> {
    const directory = join(this.root, id);
    try {
      const [rawManifest, tsx] = await Promise.all([
        Bun.file(join(directory, MANIFEST_FILE)).text(),
        Bun.file(join(directory, COMPONENT_FILE)).text(),
      ]);
      return sourceFromFiles(id, { manifest: rawManifest, tsx });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read app definition "${id}": ${detail}`, { cause: error });
    }
  }
}

function sourceFromFiles(id: string, files: AppDefinitionFiles): AppDefinitionSource {
  const candidate = parseAppDefinitionFiles(files);
  return materializeDefinition({ id, ...candidate.definition });
}

function materializeDefinition(source: UnversionedAppDefinition): AppDefinitionSource {
  const revision = Bun.CryptoHasher.hash("sha256", JSON.stringify(source), "hex").slice(0, 24);
  return { ...source, revision };
}

function materializeBuiltInDefinition(source: UnversionedAppDefinition): AppDefinitionSource {
  if (!source.id.startsWith(BUILT_IN_APP_DEFINITION_PREFIX)) {
    throw new Error(
      `Built-in app definition "${source.id}" must use the "${BUILT_IN_APP_DEFINITION_PREFIX}" prefix.`,
    );
  }
  return materializeDefinition({
    ...source,
    state: appStateDefinitionSchema.parse(source.state),
  });
}

/** Parse and validate raw definition files once before compilation or activation. */
export function parseAppDefinitionFiles(files: AppDefinitionFiles): AppDefinitionCandidate {
  const manifest = appManifestSchema.parse(JSON.parse(files.manifest));
  return {
    files,
    definition: {
      ...manifest,
      tsx: appComponentSourceSchema.parse(files.tsx),
    },
  };
}

function definitionFromSource(source: AppDefinitionSource): AppDefinition {
  const { tsx: _, ...definition } = source;
  return definition;
}

function defaultAppsRoot(): string {
  return join(homedir(), ".toy-box", "apps");
}

function parseDefinitionId(value: string): string {
  const result = appDefinitionIdSchema.safeParse(value);
  if (!result.success) throw new Error("Invalid app definition id.");
  return result.data;
}

function parseOwnerDefinitionId(value: string): string {
  const result = ownerAppDefinitionIdSchema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid app definition id.");
  }
  return result.data;
}

export const appDefinitionRegistry = new AppDefinitionRegistry(
  defaultAppsRoot(),
  BUILT_IN_APP_DEFINITIONS,
);
