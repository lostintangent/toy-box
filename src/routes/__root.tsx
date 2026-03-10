import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";

import appCss from "./styles.css?url";
import { ViewportProvider } from "@/hooks/browser/ViewportContext";

const APP_TITLE = import.meta.env.VITE_APP_TITLE;

type RouterContext = {
  queryClient: QueryClient;
};

// Loading indicator shown during route transitions
function RouteLoadingIndicator() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <div className="h-1 bg-primary animate-pulse" />
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { title: APP_TITLE },
      // PWA meta tags for iOS
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: APP_TITLE },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/logo192.png" },
    ],
  }),

  component: RootComponent,
  pendingComponent: RouteLoadingIndicator,
  shellComponent: RootDocument,
});

function RootComponent() {
  return (
    <ViewportProvider>
      <Outlet />
    </ViewportProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="h-dvh overflow-hidden bg-background safe-top safe-x">
        <div className="h-full overflow-hidden">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
