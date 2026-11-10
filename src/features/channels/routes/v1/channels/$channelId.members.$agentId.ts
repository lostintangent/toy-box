import { createFileRoute } from "@tanstack/react-router";
import { updateChannelMemberInputSchema } from "@channels/model";
import { isChannelMember, removeChannelMember, updateChannelMember } from "@channels/server";
import { noContent, notFound, readInput, respond } from "@channels/server/http";

/** A member is reached only through its own Channel, whose ID its changes never carry. */
export const Route = createFileRoute("/api/v1/channels/$channelId/members/$agentId")({
  server: {
    handlers: {
      PATCH: ({ params: { channelId, agentId }, request }) =>
        respond(`update member ${agentId}`, async () => {
          const input = await readInput(request, updateChannelMemberInputSchema, { agentId });
          return (await isChannelMember(channelId, agentId))
            ? Response.json(await updateChannelMember(input))
            : notFound("Channel member");
        }),
      DELETE: ({ params: { channelId, agentId } }) =>
        respond(`remove member ${agentId}`, async () => {
          if (!(await isChannelMember(channelId, agentId))) return notFound("Channel member");
          await removeChannelMember(agentId, { type: "user" });
          return noContent();
        }),
    },
  },
});
