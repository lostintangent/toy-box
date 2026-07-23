import { lazy, type ComponentType } from "react";
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
  PenTool,
  Table,
  type LucideIcon,
} from "lucide-react";
import type { Artifact } from "@/hooks/artifacts/useArtifact";
import type { ArtifactPaneMode } from "@/lib/workspace/panes";
import type { PaneVariant } from "../../types";
import type { ArtifactWorker, CustomArtifactKind, JsonValue } from "@/types";
import { getPathBasename } from "@/lib/paths";
import { artifactName } from "@/lib/session/artifacts/display";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import { HtmlArtifact } from "./html/HtmlArtifact";
import { CustomArtifact } from "./CustomArtifact";

// Rendering registry for built-in and user-registered file kinds. Pane state
// stores only the path; rendering details are resolved here at the point of use.

export type ArtifactRendererProps = {
  sessionId: string;
  path: string;
  title: string;
  mode: ArtifactPaneMode;
  variant: PaneVariant;
  baseUri?: string;
  definition?: CustomArtifactKind;
  artifact: Artifact;
  pendingWorkers: ArtifactWorker[];
  spawnWorker: (request: ArtifactWorkerRequest) => Promise<{ sessionId: string }>;
};

export type ArtifactWorkerRequest = {
  name?: string;
  prompt: string;
  metadata?: JsonValue;
};

export type ArtifactKind = {
  extensions: string[];
  Renderer: ComponentType<ArtifactRendererProps>;
  icon: LucideIcon;
  editable?: boolean;
  fileIcons?: Record<string, LucideIcon>;
  definition?: CustomArtifactKind;
};

const MarkdownArtifact = lazy(() =>
  import("./markdown/MarkdownArtifact").then((module) => ({ default: module.MarkdownArtifact })),
);

const SvgArtifact = lazy(() =>
  import("./svg/SvgArtifact").then((module) => ({ default: module.SvgArtifact })),
);

const BUILTIN_ARTIFACT_KINDS: Record<string, ArtifactKind> = {
  markdown: {
    extensions: ["md", "markdown"],
    Renderer: MarkdownArtifact,
    icon: FileText,
    fileIcons: { "plan.md": ListTodo },
  },
  html: {
    extensions: ["html", "htm"],
    Renderer: HtmlArtifact,
    icon: Code2,
  },
  svg: {
    extensions: ["svg"],
    Renderer: SvgArtifact,
    icon: PenTool,
  },
};

const FALLBACK_ARTIFACT_KIND = BUILTIN_ARTIFACT_KINDS.markdown;

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
    Renderer: CustomArtifact,
    icon: (definition.icon && CUSTOM_ICONS[definition.icon]) || FileCode,
    editable: definition.editable === true,
    definition,
  };
}

function extensionOf(path: string): string {
  return getPathBasename(path).split(".").pop()?.toLowerCase() ?? "";
}

/** Built-ins win extension conflicts; unclaimed files render as Markdown. */
export function resolveArtifactKind(path: string, customKinds: CustomArtifactKind[]): ArtifactKind {
  const extension = extensionOf(path);
  for (const kind of Object.values(BUILTIN_ARTIFACT_KINDS)) {
    if (kind.extensions.includes(extension)) return kind;
  }
  const custom = customKinds.find((definition) => definition.extensions.includes(extension));
  return custom ? toArtifactKind(custom) : FALLBACK_ARTIFACT_KIND;
}

export function useArtifactKind(path: string): ArtifactKind {
  const customKinds = useWorkspaceSelector((workspace) => workspace.customArtifacts);
  return resolveArtifactKind(path, customKinds);
}

export function useArtifactDisplay(path: string): { name: string; Icon: LucideIcon } {
  const kind = useArtifactKind(path);
  const fileIcon = kind.fileIcons?.[getPathBasename(path)];
  return { name: artifactName(path), Icon: fileIcon ?? kind.icon };
}
