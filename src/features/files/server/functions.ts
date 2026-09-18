// Validated workspace-file operations consumed by Query and matching external ingress.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  createFileInputSchema,
  listDirectoryInputSchema,
  workspaceFileInputSchema,
  writeFileInputSchema,
} from "../model";
import * as files from "./index";

export const readFile = createServerFn({ method: "GET" })
  .validator(zodValidator(workspaceFileInputSchema))
  .handler(({ data }) => files.readFile(data.file));

export const writeFile = createServerFn({ method: "POST" })
  .validator(zodValidator(writeFileInputSchema))
  .handler(({ data }) => files.writeFile(data.file, data.content));

export const createFile = createServerFn({ method: "POST" })
  .validator(zodValidator(createFileInputSchema))
  .handler(({ data }) => files.createFile(data));

export const listDirectory = createServerFn({ method: "GET" })
  .validator(zodValidator(listDirectoryInputSchema))
  .handler(({ data }) => files.listDirectory(data));
