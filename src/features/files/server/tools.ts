import { defineTool } from "@github/copilot-sdk";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { customEditorKindSchema, machineFile, type WorkspaceFile } from "../model";
import { normalizeExtensions, registerEditorKind } from "./editors";

// open_file / close_file surface an existing file on disk as a live pane. The tool
// resolves the path to a machine workspace file and returns it; the SDK projector
// reads that result into a durable file_opened / file_closed session event.

function toMachineFile(path: string): WorkspaceFile {
  if (!isAbsolute(path)) throw new Error("Provide an absolute path.");
  return machineFile(resolve(path));
}

const openFile = defineTool("open_file", {
  description:
    "Opens an existing file on disk as a live pane in Toy Box so the user can view and edit it. " +
    "Use it for files outside your session files folder, which already appear automatically. " +
    "Give an absolute path.",
  parameters: z.object({
    path: z.string().trim().min(1).describe("Absolute path of the file to open."),
  }),
  skipPermission: true,
  handler: ({ path }) => JSON.stringify(toMachineFile(path)),
});

const closeFile = defineTool("close_file", {
  description:
    "Closes a file pane previously opened with open_file. Does not delete the file. Give an absolute path.",
  parameters: z.object({
    path: z.string().trim().min(1).describe("Absolute path of the open file pane to close."),
  }),
  skipPermission: true,
  handler: ({ path }) => JSON.stringify(toMachineFile(path)),
});

export const fileTools = [openFile, closeFile];

const registerEditorKindTool = defineTool("register_editor", {
  description:
    "Registers or replaces a custom editor for the supplied file extensions. Follow the loaded `create-toy-box-editor` skill for its HTML bridge contract.",
  parameters: customEditorKindSchema,
  skipPermission: true,
  handler: async (input) => {
    const extensions = normalizeExtensions(input.extensions);
    if (extensions.length === 0) {
      throw new Error("At least one valid file extension is required.");
    }

    const kind = {
      name: input.name,
      extensions,
      icon: input.icon,
      editable: input.editable ?? false,
      html: input.html,
    };

    await registerEditorKind(kind);

    return JSON.stringify({
      registered: kind.name,
      extensions: kind.extensions,
      note: "Matching files now use this kind.",
    });
  },
});

export const editorTools = [registerEditorKindTool];
