import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCache } from "@workspace/sync";
import { providerQueries } from "./queries";

function invalidateProviderQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: providerQueries.all() });
}

export default {
  applyEvent(queryClient, event) {
    if (event.type === "providers.changed") void invalidateProviderQueries(queryClient);
  },
  refresh: invalidateProviderQueries,
} satisfies WorkspaceCache;
