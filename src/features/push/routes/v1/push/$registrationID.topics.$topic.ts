import { createFileRoute } from "@tanstack/react-router";
import { pushRegistrationIdSchema, pushSubscriptionSchema } from "@push/model";
import { subscribeInstall, unsubscribeInstall } from "@push/server";
import { invalidRequest, NotFoundError, readInput, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/push/$registrationID/topics/$topic")({
  server: {
    handlers: {
      PUT: ({ params: { registrationID, topic }, request }) =>
        respond(`subscribe to ${topic}`, async () => {
          const input = await readInput(request, pushSubscriptionSchema);
          if (!pushRegistrationIdSchema.safeParse(registrationID).success) throw invalidRequest();
          if (!(await subscribeInstall({ registrationID, ...input }, topic)))
            throw new NotFoundError("Push registration");
        }),
      DELETE: ({ params: { registrationID, topic } }) =>
        respond(`unsubscribe from ${topic}`, async () => {
          if (!pushRegistrationIdSchema.safeParse(registrationID).success) throw invalidRequest();
          await unsubscribeInstall(registrationID, topic);
        }),
    },
  },
});
