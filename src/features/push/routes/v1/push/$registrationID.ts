import { createFileRoute } from "@tanstack/react-router";
import { pushRegistrationIdSchema, pushRegistrationSchema } from "@push/model";
import { registerInstall, removeInstall } from "@push/server";
import { invalidRequest, readInput, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/push/$registrationID")({
  server: {
    handlers: {
      PUT: ({ params: { registrationID }, request }) =>
        respond("register an install", async () => {
          const input = await readInput(request, pushRegistrationSchema);
          if (!pushRegistrationIdSchema.safeParse(registrationID).success) throw invalidRequest();
          const created = await registerInstall({ registrationID, ...input });
          return new Response(null, { status: created ? 201 : 204 });
        }),
      DELETE: ({ params: { registrationID } }) =>
        respond("remove an install", async () => {
          if (!pushRegistrationIdSchema.safeParse(registrationID).success) throw invalidRequest();
          await removeInstall(registrationID);
        }),
    },
  },
});
