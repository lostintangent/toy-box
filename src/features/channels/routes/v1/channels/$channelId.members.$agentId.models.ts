import { createFileRoute } from "@tanstack/react-router";
import { getChannelMemberProvider } from "@channels/server";
import { getModelChoices } from "@providers/server";
import { NotFoundError, respond } from "@/shared/server/http";

/** Model choices stay within the member's provider; a null default does not forbid inheritance. */
export const Route = createFileRoute("/api/v1/channels/$channelId/members/$agentId/models")({
  server: {
    handlers: {
      GET: ({ params: { channelId, agentId } }) =>
        respond(`list models for member ${agentId}`, async () => {
          const provider = await getChannelMemberProvider(channelId, agentId);
          if (provider === undefined) throw new NotFoundError("Channel member");
          return { provider, ...(await getModelChoices(provider ?? undefined)) };
        }),
    },
  },
});
