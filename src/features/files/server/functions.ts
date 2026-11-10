// Validated workspace-file operations consumed by Query and matching external ingress.

import { createServerFn } from "@tanstack/react-start";
import {
  createFileInputSchema,
  listDirectoryInputSchema,
  searchFilesInputSchema,
  watchFileInputSchema,
  workspaceFileInputSchema,
  writeFileInputSchema,
} from "../model";
import * as files from "./index";

export const readFile = createServerFn({ method: "GET" })
  .validator(workspaceFileInputSchema)
  .handler(({ data }) => files.readFile(data.file));

export const writeFile = createServerFn({ method: "POST" })
  .validator(writeFileInputSchema)
  .handler(({ data }) => files.writeFile(data.file, data.content, data.notifyAgent));

export const watchFile = createServerFn({ method: "POST" })
  .validator(watchFileInputSchema)
  .handler(({ data }) => files.watchFile(data.connection, data.file));

export const createFile = createServerFn({ method: "POST" })
  .validator(createFileInputSchema)
  .handler(({ data }) => files.createFile(data));

export const listDirectory = createServerFn({ method: "GET" })
  .validator(listDirectoryInputSchema)
  .handler(({ data }) => files.listDirectory(data));

export const searchFiles = createServerFn({ method: "GET" })
  .validator(searchFilesInputSchema)
  .handler(({ data }) => files.searchFiles(data));
