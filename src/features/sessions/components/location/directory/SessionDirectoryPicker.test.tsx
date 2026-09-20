import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionContext, Session } from "../../../model";
import { createEmptySessionsState, sessionQueries } from "../../../queries";
import { SessionLocationPicker } from "../SessionLocationPicker";
import { SessionDirectoryPicker } from "./SessionDirectoryPicker";

function createSession(cwd: string): Session {
  return {
    id: "session-1",
    createdAt: new Date(0),
    updatedAt: new Date(1),
    title: "Session",
    context: { directory: cwd },
  };
}

function renderPicker(
  props: ComponentProps<typeof SessionDirectoryPicker>,
  sessions?: Session[],
  context?: SessionContext,
) {
  const queryClient = new QueryClient();
  if (context) {
    queryClient.setQueryData(sessionQueries.context(context.directory).queryKey, context);
  }
  if (sessions) {
    queryClient.setQueryData(sessionQueries.stateKey(), {
      ...createEmptySessionsState(),
      sessions,
    });
  }

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SessionDirectoryPicker, props),
    ),
  );
}

describe("SessionDirectoryPicker", () => {
  test("shows a skeleton while an untouched selection resolves its MRU", () => {
    const markup = renderPicker({ onValueChange: () => {} });

    expect(markup).toContain('aria-label="Loading working directory"');
    expect(markup).not.toContain("Select directory");
  });

  test("SSR uses the MRU's native repository metadata before directory lookup", () => {
    const markup = renderPicker({ onValueChange: () => {} }, [
      {
        ...createSession("/repo/project"),
        context: {
          directory: "/repo/project",
          gitRoot: "/repo/project",
          repository: "owner/project",
        },
      },
    ]);

    expect(markup).toContain("lucide-git-branch");
    expect(markup).toContain('aria-label="Repository: owner/project"');
    expect(markup).toContain(">project</span>");
  });

  test("shows the placeholder when no MRU exists", () => {
    const markup = renderPicker({ onValueChange: () => {} }, []);

    expect(markup).toContain("Select directory");
    expect(markup).not.toContain("Loading working directory");
  });

  test("treats null as an explicit empty selection", () => {
    const markup = renderPicker(
      { value: null, repository: "owner/project", onValueChange: () => {} },
      [createSession("/repo/project")],
      { directory: "/repo/project", repository: "owner/project" },
    );

    expect(markup).toContain("Select directory");
    expect(markup).not.toContain("Loading working directory");
    expect(markup).not.toContain("owner/project");
  });

  test("renders an explicit directory without waiting for MRU data", () => {
    const markup = renderPicker({
      value: "/explicit/project",
      onValueChange: () => {},
    });

    expect(markup).toContain('aria-label="Working directory: /explicit/project"');
    expect(markup).not.toContain("Loading working directory");
  });

  test("shows a newly selected repository without session or MRU metadata", () => {
    const markup = renderPicker({ value: "/new/project", onValueChange: () => {} }, [], {
      directory: "/new/project",
      gitRoot: "/new/project",
      repository: "owner/project",
    });

    expect(markup).toContain("lucide-git-branch");
    expect(markup).toContain("owner/project");
  });

  test("catalog Git metadata wins over conflicting directory-cache data", () => {
    const markup = renderPicker(
      {
        value: "/repo/project",
        repository: "owner/project",
        gitRoot: "/repo/project",
        onValueChange: () => {},
      },
      [],
      { directory: "/repo/project" },
    );
    expect(markup).toContain("lucide-git-branch");
    expect(markup).toContain('aria-label="Repository: owner/project"');
  });

  test("a directory without metadata does not borrow another directory's cached result", () => {
    const markup = renderPicker({ value: "/folder", onValueChange: () => {} }, [], {
      directory: "/repo/project",
      gitRoot: "/repo/project",
      repository: "owner/project",
    });
    expect(markup).not.toContain("lucide-git-branch");
    expect(markup).not.toContain("owner/project");
    expect(markup).toContain('aria-label="Working directory: /folder"');
  });

  test.each(["catalog", "query", "branch-only catalog"])(
    "%s metadata renders existing-session branch controls",
    (source) => {
      const client = new QueryClient();
      const context = {
        directory: "/repo/project",
        gitRoot: "/repo/project",
        repository: "owner/project",
        branch: "main",
      };
      if (source !== "catalog") {
        client.setQueryData(sessionQueries.context(context.directory).queryKey, {
          ...context,
          branch: source === "query" ? context.branch : undefined,
        });
      }
      const markup = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(SessionLocationPicker, {
            value: context.directory,
            ...(source === "catalog"
              ? { repository: context.repository, gitRoot: context.gitRoot, branch: context.branch }
              : source === "branch-only catalog"
                ? { branch: context.branch }
                : {}),
          }),
        ),
      );

      expect(markup).toContain("lucide-git-branch");
      expect(markup).toContain('aria-label="Repository: owner/project"');
      expect(markup).toContain('aria-haspopup="menu"');
    },
  );

  test("supports externally owned loading for existing sessions", () => {
    const markup = renderPicker({ value: "/session/project", isLoading: true });

    expect(markup).toContain('aria-label="Loading working directory"');
    expect(markup).not.toContain("/session/project");
  });

  test("shows external loading before existing-session branch controls", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionLocationPicker, {
        value: "/session/project",
        branch: "main",
        isLoading: true,
      }),
    );

    expect(markup).toContain('aria-label="Loading working directory"');
    expect(markup).not.toContain("main");
  });
});
