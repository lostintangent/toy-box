import { lazy, type ComponentType } from "react";
import { atom, useAtomValue } from "jotai";
import {
  Braces,
  ChartBar,
  Code2,
  Database,
  FileCode,
  FileJson,
  FileText,
  Image,
  List,
  ListTodo,
  Table,
  type LucideIcon,
} from "lucide-react";
import type { Artifact } from "@/hooks/artifacts/useArtifact";
import type { ArtifactWorkspacePane } from "@/lib/workspace/panes";
import type { CustomArtifactKind } from "@/types";
import { getPathBasename } from "@/lib/paths";
import { workspaceStateAtom } from "@/atoms";
import { HtmlArtifact } from "./HtmlArtifact";
import { CustomArtifact } from "./CustomArtifact";

// How a file type is rendered — the single source for how a file is matched (extensions),
// rendered (Component), and presented (icon). A pane is just `{ kind: "artifact", path }`;
// its ArtifactKind is resolved from the path here, so nothing is stored on the pane.
//
// Built-ins are declared below. User-registered kinds come from workspace state — pass them
// to `resolveArtifactKind`, or read them reactively with `useArtifactKind`. Custom kinds all
// share the one generic `CustomArtifact` renderer, which reads back the `definition`.

export type ArtifactContentProps = { pane: ArtifactWorkspacePane; artifact: Artifact };

export type ArtifactKind = {
  /** File extensions (without the dot) this kind claims, e.g. `["html", "htm"]`. */
  extensions: string[];
  Component: ComponentType<ArtifactContentProps>;
  icon: LucideIcon;
  /** Editable unless a kind opts out; gates the pane's mode switcher and saving indicator. */
  editable?: boolean;
  /** When true the artifact is rendered out-of-band via `/api/preview` (an iframe), so the
   *  hook only needs to stat it — it never reads the body. Defaults to false (the app loads it). */
  usesPreview?: boolean;
  /** Friendly labels + icon overrides for well-known files, e.g. `plan.md` → "Plan". */
  aliases?: Record<string, { label: string; icon?: LucideIcon }>;
  /** Set for user-registered kinds — the on-disk definition the generic renderer reads. */
  definition?: CustomArtifactKind;
};

const MarkdownArtifact = lazy(() =>
  import("./MarkdownArtifact").then((module) => ({ default: module.MarkdownArtifact })),
);

const BUILTIN_ARTIFACT_KINDS: Record<string, ArtifactKind> = {
  markdown: {
    extensions: ["md", "markdown"],
    Component: MarkdownArtifact,
    icon: FileText,
    aliases: { "plan.md": { label: "Plan", icon: ListTodo } },
  },
  html: {
    extensions: ["html", "htm"],
    Component: HtmlArtifact,
    icon: Code2,
    usesPreview: true,
  },
};

/** Kind used for artifacts whose extension no kind claims (e.g. `NOTES`, `data.txt`). */
const FALLBACK_ARTIFACT_KIND = BUILTIN_ARTIFACT_KINDS.markdown;

// Curated name → icon map keeps `artifact.json` declarative and stops a definition from
// injecting an arbitrary icon component.
const CUSTOM_ICONS: Record<string, LucideIcon> = {
  braces: Braces,
  json: FileJson,
  code: Code2,
  table: Table,
  list: List,
  database: Database,
  image: Image,
  chart: ChartBar,
  text: FileText,
  file: FileCode,
};

function toArtifactKind(definition: CustomArtifactKind): ArtifactKind {
  return {
    extensions: definition.extensions,
    Component: CustomArtifact,
    icon: (definition.icon && CUSTOM_ICONS[definition.icon]) || FileCode,
    editable: definition.editable,
    usesPreview: false,
    definition,
  };
}

function extensionOf(path: string): string {
  return getPathBasename(path).split(".").pop()?.toLowerCase() ?? "";
}

/** Resolve a path to its kind: a built-in wins a shared extension, then a registered custom
 *  kind, else Markdown. Pure — custom kinds are passed in (they live in workspace state). */
export function resolveArtifactKind(path: string, customKinds: CustomArtifactKind[]): ArtifactKind {
  const extension = extensionOf(path);
  for (const kind of Object.values(BUILTIN_ARTIFACT_KINDS)) {
    if (kind.extensions.includes(extension)) return kind;
  }
  const custom = customKinds.find((definition) => definition.extensions.includes(extension));
  return custom ? toArtifactKind(custom) : FALLBACK_ARTIFACT_KIND;
}

// Custom kinds are a slice of workspace state. A derived atom gives precise subscriptions —
// consumers re-render only when the kinds change, not on every workspace event.
const customArtifactKindsAtom = atom((get) => get(workspaceStateAtom).customArtifacts);

/** Reactive resolution for a rendering component — the kind for this path, current. */
export function useArtifactKind(path: string): ArtifactKind {
  return resolveArtifactKind(path, useAtomValue(customArtifactKindsAtom));
}

/** An artifact's display name — a well-known-file alias or its basename. Pure (custom kinds
 *  carry no aliases), so it works while a pane is still being built and in path-keyed lists. */
export function artifactName(path: string): string {
  const basename = getPathBasename(path);
  const extension = extensionOf(path);
  for (const kind of Object.values(BUILTIN_ARTIFACT_KINDS)) {
    if (kind.extensions.includes(extension)) return kind.aliases?.[basename]?.label ?? basename;
  }
  return basename;
}

/** Reactive name + icon for an artifact pill — an alias if it's a well-known file. */
export function useArtifactDisplay(path: string): { name: string; Icon: LucideIcon } {
  const kind = useArtifactKind(path);
  const alias = kind.aliases?.[getPathBasename(path)];
  return { name: artifactName(path), Icon: alias?.icon ?? kind.icon };
}
