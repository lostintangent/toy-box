import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionQueries } from "../../queries";
import { SessionMetadataBadges } from "./SessionMetadataBadges";

function renderBadges(client: QueryClient, props: ComponentProps<typeof SessionMetadataBadges>) {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(SessionMetadataBadges, props)),
  );
}

test("SSR renders the native repository badge before directory lookup", () => {
  const markup = renderBadges(new QueryClient(), {
    cwd: "/repo/project",
    gitRoot: "/repo/project",
    repository: "owner/project",
  });

  expect(markup).toContain("lucide-git-branch");
  expect(markup).toContain('aria-label="Repository: owner/project"');
});

test("a CWD-only session reuses resolved directory metadata for its repository badge", () => {
  const client = new QueryClient();
  client.setQueryData(sessionQueries.context("/repo/project").queryKey, {
    directory: "/repo/project",
    gitRoot: "/repo/project",
    repository: "owner/project",
  });

  const markup = renderBadges(client, { cwd: "/repo/project" });
  expect(markup).toContain("lucide-git-branch");
  expect(markup).toContain("owner/project");
});

test("a failed lookup keeps the directory visible and exposes the error", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  await expect(
    client.fetchQuery({
      ...sessionQueries.context("/missing"),
      queryFn: async () => {
        throw new Error("Directory unavailable");
      },
    }),
  ).rejects.toThrow();

  const markup = renderBadges(client, { cwd: "/missing" });
  expect(markup).toContain('aria-label="Working directory: /missing"');
  expect(markup).toContain('aria-description="Directory unavailable"');
});
