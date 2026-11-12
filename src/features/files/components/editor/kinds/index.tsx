import { lazy, type ComponentType } from "react";
import {
  Braces,
  BookOpen,
  Code2,
  FileCode,
  FileText,
  Film,
  ImageIcon,
  ListTodo,
  AppWindow,
  PenTool,
  type LucideIcon,
} from "lucide-react";
import type { PaneVariant } from "@/shared/panes/PaneSlots";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { WorkspaceFile } from "@files/model";
import {
  ARTIFACT_APP_EXTENSION,
  definitionOpening,
  type AppDefinition,
  type AppList,
} from "@apps/model";
import { appQueries } from "@apps/queries";
import { appIcon } from "@apps/components/runtime/icons";
import type { WorkspaceFileState } from "../../../useFile";
import type { WorkspaceFileMode } from "../../../model";
import { fileExtension, fileName, getPathBasename } from "../../../model/paths";
import { CodeViewer } from "./code/CodeViewer";
import { HtmlEditor } from "./html/HtmlEditor";
import { ImageViewer, VideoViewer } from "./media/MediaViewer";

// Rendering registry for built-in file kinds and installed app definitions that open
// files. Pane state stores only the path; rendering details are resolved here at the point of use.

export type EditorProps = {
  title: string;
  mode: WorkspaceFileMode;
  variant: PaneVariant;
  baseUri?: string;
  file: WorkspaceFileState;
};

export type EditorKind = {
  /** Mount identity: when it changes, the pane remounts the renderer from its latest text. */
  id: string;
  extensions: string[];
  Renderer: ComponentType<EditorProps>;
  icon: LucideIcon;
  /** Renders from the file's URL rather than its text, so it mounts without text and is read-only. */
  binary?: boolean;
  editable?: boolean;
  fileIcons?: Record<string, LucideIcon>;
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

const BriefEditor = lazy(() =>
  import("./brief/BriefEditor").then((module) => ({ default: module.BriefEditor })),
);

const ArtifactAppPane = lazy(() =>
  import("@apps/components/panes/ArtifactAppPane").then((module) => ({
    default: module.ArtifactAppPane,
  })),
);

const AppEditor = lazy(() =>
  import("@apps/components/panes/AppEditor").then((module) => ({ default: module.AppEditor })),
);

const ARTIFACT_APP_EDITOR_KIND: EditorKind = {
  id: "artifact-app",
  extensions: [ARTIFACT_APP_EXTENSION.slice(1)],
  Renderer: ArtifactAppPane,
  icon: AppWindow,
  editable: false,
};

const CODE_VIEWER_KIND: EditorKind = {
  id: "code",
  extensions: [],
  Renderer: CodeViewer,
  icon: FileCode,
  editable: false,
};

const BUILTIN_EDITOR_KINDS: EditorKind[] = [
  {
    id: "markdown",
    extensions: ["md", "markdown"],
    Renderer: MarkdownEditor,
    icon: FileText,
    fileIcons: { "plan.md": ListTodo },
  },
  {
    id: "html",
    extensions: ["html", "htm"],
    Renderer: HtmlEditor,
    icon: Code2,
  },
  {
    id: "svg",
    extensions: ["svg"],
    Renderer: SvgEditor,
    icon: PenTool,
  },
  {
    id: "json",
    extensions: ["json"],
    Renderer: JsonEditor,
    icon: Braces,
  },
  {
    id: "brief",
    extensions: ["brief"],
    Renderer: BriefEditor,
    icon: BookOpen,
  },
  {
    id: "image",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"],
    Renderer: ImageViewer,
    icon: ImageIcon,
    binary: true,
  },
  {
    id: "video",
    extensions: ["mp4", "webm", "mov"],
    Renderer: VideoViewer,
    icon: Film,
    binary: true,
  },
];

/** Session `.toy` files run as apps, built-ins win extension conflicts, then installed definitions, and unclaimed files render read-only as code. */
export function resolveEditorKind(file: WorkspaceFile, definitions: AppDefinition[]): EditorKind {
  const extension = fileExtension(file.path);
  if (file.kind === "session" && ARTIFACT_APP_EDITOR_KIND.extensions.includes(extension)) {
    return ARTIFACT_APP_EDITOR_KIND;
  }
  for (const kind of BUILTIN_EDITOR_KINDS) {
    if (kind.extensions.includes(extension)) return kind;
  }
  const definition = definitionOpening(definitions, extension);
  if (!definition) return CODE_VIEWER_KIND;
  return {
    id: `${definition.id}:${definition.revision}`,
    extensions: definition.opens,
    Renderer: AppEditor,
    icon: appIcon(definition.icon),
  };
}

const selectDefinitions = (list: AppList) => list.definitions;

export function useEditorKind(file: WorkspaceFile): EditorKind {
  const { data: definitions } = useSuspenseQuery({
    ...appQueries.list,
    select: selectDefinitions,
  });
  return resolveEditorKind(file, definitions);
}

export function useEditorDisplay(file: WorkspaceFile): { name: string; Icon: LucideIcon } {
  const kind = useEditorKind(file);
  const fileIcon = kind.fileIcons?.[getPathBasename(file.path)];
  return { name: fileName(file.path), Icon: fileIcon ?? kind.icon };
}
