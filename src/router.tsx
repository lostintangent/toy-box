import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data is fresh for 30 seconds, then background refetch
        staleTime: 30_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultNotFoundComponent: () => (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Page not found</p>
      </div>
    ),
  });

  // Integrates TanStack Query with TanStack Router for SSR
  // - Automatic dehydration/hydration
  // - Streaming support
  // - QueryClientProvider wrapping
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
