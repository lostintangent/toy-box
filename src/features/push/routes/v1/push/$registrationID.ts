import { createFileRoute } from "@tanstack/react-router";
import { pushRegistrationIdSchema, pushRegistrationSchema } from "@push/model";
import { registerInstall, removeInstall } from "@push/server";

const invalid = () => Response.json({ error: "Invalid push registration." }, { status: 400 });

export const Route = createFileRoute("/api/v1/push/$registrationID")({
  server: {
    handlers: {
      PUT: async ({ params: { registrationID }, request }) => {
        const input = pushRegistrationSchema.safeParse(await request.json().catch(() => undefined));
        if (!input.success || !pushRegistrationIdSchema.safeParse(registrationID).success)
          return invalid();
        const created = await registerInstall({ registrationID, ...input.data });
        return new Response(null, { status: created ? 201 : 204 });
      },
      DELETE: async ({ params: { registrationID } }) => {
        if (!pushRegistrationIdSchema.safeParse(registrationID).success) return invalid();
        await removeInstall(registrationID);
        return new Response(null, { status: 204 });
      },
    },
  },
});
