import { lazy, type ComponentType } from "react";
import { Code2, FileText, ListTodo, type LucideIcon } from "lucide-react";
import type { Artifact } from "@/hooks/artifacts/useArtifact";
import type { ArtifactGridPane, ArtifactKind } from "@/hooks/session/sessionPanes";
import { getPathBasename } from "@/lib/paths";
import { HtmlArtifact } from "./HtmlArtifact";

// The registry of artifact pane kinds. Each descriptor is the single source for how a
// kind is matched (extensions), rendered (Component), and presented (icon, dot color) —
// so adding a kind is one entry here plus its content component. Content components are
// lazy-loaded only when they pull real weight (Markdown → Documint); light ones stay eager.

export type ArtifactContentProps = { pane: ArtifactGridPane; artifact: Artifact };

type ArtifactKindDescriptor = {
  /** File extensions (without the dot) this kind claims, e.g. `["html", "htm"]`. */
  extensions: string[];
  Component: ComponentType<ArtifactContentProps>;
  icon: LucideIcon;
  dotClass: string;
  /** When true the artifact is rendered out-of-band via `/api/preview` (an iframe), so the
   *  hook only needs to stat it — it never reads the body. Defaults to false (the app loads it). */
  usesPreview?: boolean;
  /** Friendly labels + icon overrides for well-known files, e.g. `plan.md` → "Plan". */
  aliases?: Record<string, { label: string; icon?: LucideIcon }>;
};

const MarkdownArtifact = lazy(() =>
  import("./MarkdownArtifact").then((module) => ({ default: module.MarkdownArtifact })),
);

export const ARTIFACT_KINDS: Record<ArtifactKind, ArtifactKindDescriptor> = {
  markdown: {
    extensions: ["md", "markdown"],
    Component: MarkdownArtifact,
    icon: FileText,
    dotClass: "bg-emerald-500",
    aliases: { "plan.md": { label: "Plan", icon: ListTodo } },
  },
  html: {
    extensions: ["html", "htm"],
    Component: HtmlArtifact,
    icon: Code2,
    dotClass: "bg-amber-500",
    usesPreview: true,
  },
};

/** Kind used for artifacts whose extension no kind claims (e.g. `NOTES`, `data.txt`). */
const FALLBACK_ARTIFACT_KIND: ArtifactKind = "markdown";

const ARTIFACT_KIND_KEYS = Object.keys(ARTIFACT_KINDS) as ArtifactKind[];

export function resolveArtifactKind(path: string): ArtifactKind {
  const extension = getPathBasename(path).split(".").pop()?.toLowerCase() ?? "";
  return (
    ARTIFACT_KIND_KEYS.find((kind) => ARTIFACT_KINDS[kind].extensions.includes(extension)) ??
    FALLBACK_ARTIFACT_KIND
  );
}

/** The display name and icon for an artifact path — an alias if it's a well-known file,
 *  otherwise its basename and its kind's default icon. Shared by the pill and the pager dot. */
export function artifactDisplay(path: string): { name: string; Icon: LucideIcon } {
  const kind = ARTIFACT_KINDS[resolveArtifactKind(path)];
  const alias = kind.aliases?.[getPathBasename(path)];
  return { name: alias?.label ?? getPathBasename(path), Icon: alias?.icon ?? kind.icon };
}
