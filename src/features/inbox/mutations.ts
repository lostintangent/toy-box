import { mutationOptions } from "@tanstack/react-query";
import { deleteInboxEntry, dispatchInboxTask } from "./server/functions";
import { applyWorkspaceEvent } from "@workspace/queries";
import type { SessionLaunch } from "@sessions/model";

export const inboxMutations = {
  dispatchTask: () =>
    mutationOptions({
      mutationFn: (launch: SessionLaunch) => dispatchInboxTask({ data: launch }),
    }),

  deleteEntry: (entryId: string) =>
    mutationOptions({
      mutationFn: () => deleteInboxEntry({ data: { entryId } }),
      onSuccess: (_deleted, _variables, _context, { client }) => {
        applyWorkspaceEvent(client, { type: "inbox.entry.deleted", entryId });
      },
    }),
};
