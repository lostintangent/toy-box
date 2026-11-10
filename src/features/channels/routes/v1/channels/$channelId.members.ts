import { createFileRoute } from "@tanstack/react-router";
import { createChannelMemberInputSchema } from "@channels/model";
import { createChannelMember } from "@channels/server";
import { readInput, respond } from "@channels/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/members")({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        respond(`add a member to Channel ${params.channelId}`, async () => {
          const input = await readInput(request, createChannelMemberInputSchema, params);
          return Response.json(await createChannelMember(input), { status: 201 });
        }),
    },
  },
});
