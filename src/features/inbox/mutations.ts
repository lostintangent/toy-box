import { mutationOptions } from "@tanstack/react-query";
import { deleteInboxEntry, dispatchInboxTask } from "./server/functions";
import { optimisticMutation } from "@workspace/sync";
import type { SessionLaunch } from "@sessions/model";

export const inboxMutations = {
  dispatchTask: () =>
    mutationOptions({
      mutationFn: (launch: SessionLaunch) => dispatchInboxTask({ data: launch }),
    }),

  deleteEntry: (entryId: string) =>
    optimisticMutation({ type: "session.deleted", sessionId: entryId }, () =>
      deleteInboxEntry({ data: { entryId } }),
    ),
};
