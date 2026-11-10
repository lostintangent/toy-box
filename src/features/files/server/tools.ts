import { defineTool } from "@sessions/server/tools/definition";
import { isAbsolute } from "node:path";
import { z } from "zod";

// Successful calls project file visibility from their recorded path arguments.
const absolutePath = z.string().trim().min(1).refine(isAbsolute, "Provide an absolute path.");

const openFile = defineTool("open_file", {
  description:
    "Opens an existing file on disk as a live pane in Toy Box so the user can view and edit it. " +
    "Use it for files outside your session artifacts folder, which already appear automatically. " +
    "Give an absolute path.",
  parameters: z.object({
    path: absolutePath.describe("Absolute path of the file to open."),
  }),
  handler: () => "Opened file.",
});

const closeFile = defineTool("close_file", {
  description:
    "Closes a file pane previously opened with open_file. Does not delete the file. Give an absolute path.",
  parameters: z.object({
    path: absolutePath.describe("Absolute path of the open file pane to close."),
  }),
  handler: () => "Closed file.",
});

export const fileTools = [openFile, closeFile];
