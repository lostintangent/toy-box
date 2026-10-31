// Validated Inbox operations shared by UI clients and other external ingress.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { sessionLaunchSchema } from "@sessions/model/protocol";
import { inboxEntryIdInputSchema } from "../model";
import * as lifecycle from "./index";

export const listInboxEntries = createServerFn({ method: "GET" }).handler(() =>
  lifecycle.listInboxEntries(),
);

export const dispatchInboxTask = createServerFn({ method: "POST" })
  .validator(zodValidator(sessionLaunchSchema))
  .handler(({ data }) => lifecycle.dispatchInboxTask(data));

export const deleteInboxEntry = createServerFn({ method: "POST" })
  .validator(zodValidator(inboxEntryIdInputSchema))
  .handler(({ data }) => lifecycle.deleteInboxEntry(data.entryId));
