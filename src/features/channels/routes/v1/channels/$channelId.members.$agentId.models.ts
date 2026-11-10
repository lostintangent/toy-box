import { createFileRoute } from "@tanstack/react-router";
import { getChannelMemberProvider } from "@channels/server";
import { notFound, respond } from "@channels/server/http";
import { getModelChoices } from "@providers/server";

/** Model choices stay within the member's provider; a null default does not forbid inheritance. */
export const Route = createFileRoute("/api/v1/channels/$channelId/members/$agentId/models")({
  server: {
    handlers: {
      GET: ({ params: { channelId, agentId } }) =>
        respond(`list models for member ${agentId}`, async () => {
          const provider = await getChannelMemberProvider(channelId, agentId);
          if (provider === undefined) return notFound("Channel member");
          return Response.json(
            { provider, ...(await getModelChoices(provider ?? undefined)) },
            { headers: { "Cache-Control": "no-store" } },
          );
        }),
    },
  },
});
