import { createFileRoute } from "@tanstack/react-router";
import { linkInputSchema, linkServer, requestLink, unlinkServer } from "@channels/server/links";
import { invalidRequest, readInput, respond } from "@/shared/server/http";
import { getServer } from "@workspace/server/installation";

/** The owner links and unlinks their other servers here, on both ends. Every answer is the whole
 *  server, whose `links` are in the order they were linked. */
export const Route = createFileRoute("/api/v1/server/links")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond("link a server", async () => {
          const { address } = await readInput(request, linkInputSchema);
          await linkServer(address, requestLink(request));
          return getServer();
        }),
      // The address is in the query, so no intermediary drops a DELETE's body.
      DELETE: ({ request }) =>
        respond("unlink a server", async () => {
          const address = new URL(request.url).searchParams.get("address");
          if (address === null) throw invalidRequest();
          await unlinkServer(address, requestLink(request));
          return getServer();
        }),
    },
  },
});
