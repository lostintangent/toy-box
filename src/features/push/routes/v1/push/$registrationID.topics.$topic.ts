import { createFileRoute } from "@tanstack/react-router";
import { pushRegistrationIdSchema, pushSubscriptionSchema } from "@push/model";
import { subscribeInstall, unsubscribeInstall } from "@push/server";

const invalid = () => Response.json({ error: "Invalid push registration." }, { status: 400 });

export const Route = createFileRoute("/api/v1/push/$registrationID/topics/$topic")({
  server: {
    handlers: {
      PUT: async ({ params: { registrationID, topic }, request }) => {
        const input = pushSubscriptionSchema.safeParse(await request.json().catch(() => undefined));
        if (!input.success || !pushRegistrationIdSchema.safeParse(registrationID).success)
          return invalid();
        if (!(await subscribeInstall({ registrationID, ...input.data }, topic)))
          return Response.json({ error: "Push registration not found." }, { status: 404 });
        return new Response(null, { status: 204 });
      },
      DELETE: async ({ params: { registrationID, topic } }) => {
        if (!pushRegistrationIdSchema.safeParse(registrationID).success) return invalid();
        await unsubscribeInstall(registrationID, topic);
        return new Response(null, { status: 204 });
      },
    },
  },
});
