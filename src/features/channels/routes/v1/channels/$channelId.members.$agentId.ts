import { createFileRoute } from "@tanstack/react-router";
import { updateChannelMemberInputSchema } from "@channels/model";
import { isChannelMember, removeChannelMember, updateChannelMember } from "@channels/server";
import { NotFoundError, readInput, respond } from "@/shared/server/http";

/** A member is reached only through its own Channel, whose ID its changes never carry. */
export const Route = createFileRoute("/api/v1/channels/$channelId/members/$agentId")({
  server: {
    handlers: {
      PATCH: ({ params: { channelId, agentId }, request }) =>
        respond(`update member ${agentId}`, async () => {
          const input = await readInput(request, updateChannelMemberInputSchema, { agentId });
          if (!(await isChannelMember(channelId, agentId)))
            throw new NotFoundError("Channel member");
          return updateChannelMember(input);
        }),
      DELETE: ({ params: { channelId, agentId } }) =>
        respond(`remove member ${agentId}`, async () => {
          if (!(await isChannelMember(channelId, agentId)))
            throw new NotFoundError("Channel member");
          await removeChannelMember(agentId, { type: "user" });
        }),
    },
  },
});
