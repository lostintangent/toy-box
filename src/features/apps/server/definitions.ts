// File-backed installed app definitions.
//
// Each definition lives under `~/.toy-box/apps/<id>/` as an inspectable
// manifest and one TSX component. Saved instances live separately in SQLite and
// reference the definition by id.

import type { Dirent } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  appComponentSourceSchema,
  appDefinitionIdSchema,
  appManifestSchema,
  type AppDefinition,
} from "@apps/model";
import type { CompiledAppBundle } from "@apps/runtime";

const MANIFEST_FILE = "app.json";
const COMPONENT_FILE = "app.tsx";

type AppDefinitionSource = AppDefinition & { tsx: string };
type AppDefinitionEntry = {
  source: AppDefinitionSource;
  bundle?: Promise<CompiledAppBundle>;
};

export type AppDefinitionFiles = { manifest: string; tsx: string };

export type AppDefinitionCandidate = {
  files: AppDefinitionFiles;
  definition: Omit<AppDefinitionSource, "id" | "revision">;
};

export class AppDefinitionRegistry {
  private installedDefinitions?: Promise<Map<string, AppDefinitionEntry>>;

  constructor(private readonly root = defaultAppsRoot()) {}

  async list(): Promise<AppDefinition[]> {
    const definitions = [...(await this.getInstalledDefinitions()).values()].map(({ source }) =>
      definitionFromSource(source),
    );
    return definitions.sort((left, right) => left.title.localeCompare(right.title));
  }

  async get(definitionId: string): Promise<AppDefinitionSource | null> {
    const id = parseDefinitionId(definitionId);
    return (await this.getInstalledDefinitions()).get(id)?.source ?? null;
  }

  async getBundle(definitionId: string, revision: string): Promise<CompiledAppBundle> {
    const id = parseDefinitionId(definitionId);
    const entry = (await this.getInstalledDefinitions()).get(id);
    if (!entry) throw new Error(`App definition "${definitionId}" was not found.`);
    if (entry.source.revision !== revision) {
      throw new Error(`App definition "${definitionId}" changed while it was loading.`);
    }

    return (entry.bundle ??= import("./compiler")
      .then(({ compileAppDefinition }) => compileAppDefinition(entry.source))
      .catch((error) => {
        delete entry.bundle;
        throw error;
      }));
  }

  /** Validate and activate the current files for one installed definition. */
  async register(definitionId: string): Promise<AppDefinition> {
    const id = parseDefinitionId(definitionId);

    const installed = await this.getInstalledDefinitions();
    const source = await this.readDiskDefinition(id);
    const current = installed.get(id);
    if (current?.source.revision === source.revision && current.bundle) {
      await current.bundle;
    } else {
      const { compileAppDefinition } = await import("./compiler");
      const bundle = await compileAppDefinition(source);
      installed.set(id, { source, bundle: Promise.resolve(bundle) });
    }
    return definitionFromSource(source);
  }

  /** Compile one validated definition before activating its exact source files. */
  async install(definitionId: string, candidate: AppDefinitionCandidate): Promise<AppDefinition> {
    const id = parseDefinitionId(definitionId);

    const installed = await this.getInstalledDefinitions();
    if (installed.has(id)) throw new Error(`App definition "${id}" is already installed.`);

    const source = materializeDefinition({ id, ...candidate.definition });
    const { compileAppDefinition } = await import("./compiler");
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

    installed.set(id, { source, bundle: Promise.resolve(bundle) });
    return definitionFromSource(source);
  }

  /** Remove one installed definition from disk and the active registry. */
  async uninstall(definitionId: string): Promise<boolean> {
    const id = parseDefinitionId(definitionId);

    const installed = await this.getInstalledDefinitions();
    try {
      await rm(join(this.root, id), { recursive: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      if (!installed.has(id)) return false;
    }
    installed.delete(id);
    return true;
  }

  private getInstalledDefinitions(): Promise<Map<string, AppDefinitionEntry>> {
    this.installedDefinitions ??= this.readInstalledDefinitions();
    return this.installedDefinitions;
  }

  private async readInstalledDefinitions(): Promise<Map<string, AppDefinitionEntry>> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      entries = [];
    }

    const diskDefinitions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const id = appDefinitionIdSchema.safeParse(entry.name);
          if (!id.success) return null;
          try {
            return await this.readDiskDefinition(id.data);
          } catch (error) {
            console.error(`Skipping invalid app definition "${entry.name}":`, error);
            return null;
          }
        }),
    );

    return new Map(
      diskDefinitions
        .filter((definition): definition is AppDefinitionSource => definition !== null)
        .map((source) => [source.id, { source }]),
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

function materializeDefinition(source: Omit<AppDefinitionSource, "revision">): AppDefinitionSource {
  const revision = Bun.CryptoHasher.hash("sha256", JSON.stringify(source), "hex").slice(0, 24);
  return { ...source, revision };
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

export const appDefinitionRegistry = new AppDefinitionRegistry();
