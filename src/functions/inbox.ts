// Client RPC boundary for dispatching durable Inbox-managed tasks.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { dispatchInboxTask as dispatchInboxTaskOnServer } from "./inbox/dispatcher";
import { sessionLaunchSchema } from "@/lib/session/protocol";

export const dispatchInboxTask = createServerFn({ method: "POST" })
  .validator(zodValidator(sessionLaunchSchema))
  .handler(async ({ data }) => dispatchInboxTaskOnServer(data));
