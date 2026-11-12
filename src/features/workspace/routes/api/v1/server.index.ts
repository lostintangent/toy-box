import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { settingsSchema } from "@workspace/model/config/settings";
import { getServer } from "@workspace/server/installation";
import { updateSettings } from "@workspace/server/state";
import { readInput, respond } from "@/shared/server/http";

// Each detail keeps its settings field's own rule, so every writer shares it.
const serverUpdateSchema = z
  .object({ name: settingsSchema.shape.serverName, accentColor: settingsSchema.shape.accentColor })
  .partial();

export const Route = createFileRoute("/api/v1/server/")({
  server: {
    handlers: {
      GET: () => respond("read the server", getServer),
      PATCH: ({ request }) =>
        respond("change the server's details", async () => {
          const { name, accentColor } = await readInput(request, serverUpdateSchema);
          await updateSettings({
            ...(name !== undefined && { serverName: name }),
            ...(accentColor !== undefined && { accentColor }),
          });
          return getServer();
        }),
    },
  },
});
