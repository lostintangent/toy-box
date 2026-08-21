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
  AppWindow,
  PenTool,
  Table,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { PaneVariant } from "@workspace/components/panes/WorkspacePaneView";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import type { CustomEditorKind, WorkspaceFile } from "@files/model";
import { ARTIFACT_APP_EXTENSION } from "@apps/model";
import type { Worker } from "@workers/model";
import type { FileState, WorkerRequest } from "../../../useFile";
import type { WorkspaceFileMode } from "../../../model";
import { fileName, getPathBasename } from "../../../model/paths";
import { HtmlEditor } from "./html/HtmlEditor";
import { CustomEditor } from "./custom/CustomEditor";

// Rendering registry for built-in and user-registered file kinds. Pane state
// stores only the path; rendering details are resolved here at the point of use.

export type EditorProps = {
  title: string;
  mode: WorkspaceFileMode;
  variant: PaneVariant;
  baseUri?: string;
  definition?: CustomEditorKind;
  file: FileState;
  pendingWorkers: Worker[];
  spawnWorker?: (request: WorkerRequest) => Promise<{ sessionId: string }>;
};

export type EditorKind = {
  extensions: string[];
  Renderer: ComponentType<EditorProps>;
  icon: LucideIcon;
  editable?: boolean;
  fileIcons?: Record<string, LucideIcon>;
  definition?: CustomEditorKind;
};

const MarkdownEditor = lazy(() =>
  import("./markdown/MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })),
);

const SvgEditor = lazy(() =>
  import("./svg/SvgEditor").then((module) => ({ default: module.SvgEditor })),
);

const JsonEditor = lazy(() =>
  import("./json/JsonEditor").then((module) => ({ default: module.JsonEditor })),
);

const IntentEditor = lazy(() =>
  import("./intent/IntentEditor").then((module) => ({ default: module.IntentEditor })),
);

const ArtifactAppPane = lazy(() =>
  import("@apps/components/panes/ArtifactAppPane").then((module) => ({
    default: module.ArtifactAppPane,
  })),
);

const ARTIFACT_APP_EDITOR_KIND: EditorKind = {
  extensions: [ARTIFACT_APP_EXTENSION.slice(1)],
  Renderer: ArtifactAppPane,
  icon: AppWindow,
  editable: false,
};

const BUILTIN_EDITOR_KINDS: Record<string, EditorKind> = {
  markdown: {
    extensions: ["md", "markdown"],
    Renderer: MarkdownEditor,
    icon: FileText,
    fileIcons: { "plan.md": ListTodo },
  },
  html: {
    extensions: ["html", "htm"],
    Renderer: HtmlEditor,
    icon: Code2,
  },
  svg: {
    extensions: ["svg"],
    Renderer: SvgEditor,
    icon: PenTool,
  },
  json: {
    extensions: ["json"],
    Renderer: JsonEditor,
    icon: Braces,
  },
  intent: {
    extensions: ["intent"],
    Renderer: IntentEditor,
    icon: Target,
  },
};

const FALLBACK_EDITOR_KIND = BUILTIN_EDITOR_KINDS.markdown;

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

function toEditorKind(definition: CustomEditorKind): EditorKind {
  return {
    extensions: definition.extensions,
    Renderer: CustomEditor,
    icon: (definition.icon && CUSTOM_ICONS[definition.icon]) || FileCode,
    editable: definition.editable === true,
    definition,
  };
}

function extensionOf(path: string): string {
  return getPathBasename(path).split(".").pop()?.toLowerCase() ?? "";
}

/** Built-ins win extension conflicts; unclaimed files render as Markdown. */
export function resolveEditorKind(
  file: WorkspaceFile,
  customKinds: CustomEditorKind[],
): EditorKind {
  const extension = extensionOf(file.path);
  if (file.type === "session" && ARTIFACT_APP_EDITOR_KIND.extensions.includes(extension)) {
    return ARTIFACT_APP_EDITOR_KIND;
  }
  for (const kind of Object.values(BUILTIN_EDITOR_KINDS)) {
    if (kind.extensions.includes(extension)) return kind;
  }
  const custom = customKinds.find((definition) => definition.extensions.includes(extension));
  return custom ? toEditorKind(custom) : FALLBACK_EDITOR_KIND;
}

export function useEditorKind(file: WorkspaceFile): EditorKind {
  const customKinds = useWorkspaceSelector((workspace) => workspace.customEditors);
  return resolveEditorKind(file, customKinds);
}

export function useEditorDisplay(file: WorkspaceFile): { name: string; Icon: LucideIcon } {
  const kind = useEditorKind(file);
  const fileIcon = kind.fileIcons?.[getPathBasename(file.path)];
  return { name: fileName(file.path), Icon: fileIcon ?? kind.icon };
}
