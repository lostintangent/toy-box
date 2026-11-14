import { createFileRoute } from "@tanstack/react-router";
import { receiveChannelLeadMessage } from "@channels/server";
import { peerLeadMessageInputSchema } from "@channels/server/peers";
import { disableIdleTimeout, readInput, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/lead-messages")({
  server: {
    handlers: {
      /** A peer server's lead messages this Channel's lead. It answers once the lead has accepted
       *  the message, not once it replies, which can wait on a cold lead. */
      POST: ({ params, request }) => {
        disableIdleTimeout(request);
        return respond("deliver a lead message", async () => {
          const input = await readInput(request, peerLeadMessageInputSchema, params);
          await receiveChannelLeadMessage(input);
        });
      },
    },
  },
});
