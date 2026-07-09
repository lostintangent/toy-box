import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptySessionsState, sessionQueries } from "@/lib/queries";
import type { SessionMetadata } from "@/types";
import { SessionLocationPicker } from "../SessionLocationPicker";
import { SessionDirectoryPicker } from "./SessionDirectoryPicker";

function createSession(cwd: string): SessionMetadata {
  return {
    sessionId: "session-1",
    startTime: new Date(0),
    modifiedTime: new Date(1),
    summary: "Session",
    isRemote: false,
    context: { workingDirectory: cwd },
  };
}

function renderPicker(
  props: ComponentProps<typeof SessionDirectoryPicker>,
  sessions?: SessionMetadata[],
) {
  const queryClient = new QueryClient();
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

  test("uses the MRU after recent directories load", () => {
    const markup = renderPicker({ onValueChange: () => {} }, [createSession("/repo/project")]);

    expect(markup).toContain('aria-label="Working directory: /repo/project"');
    expect(markup).toContain(">project</span>");
  });

  test("shows the placeholder when no MRU exists", () => {
    const markup = renderPicker({ onValueChange: () => {} }, []);

    expect(markup).toContain("Select directory");
    expect(markup).not.toContain("Loading working directory");
  });

  test("treats null as an explicit empty selection", () => {
    const markup = renderPicker({ value: null, onValueChange: () => {} }, [
      createSession("/repo/project"),
    ]);

    expect(markup).toContain("Select directory");
    expect(markup).not.toContain("Loading working directory");
  });

  test("renders an explicit directory without waiting for MRU data", () => {
    const markup = renderPicker({
      value: "/explicit/project",
      onValueChange: () => {},
    });

    expect(markup).toContain('aria-label="Working directory: /explicit/project"');
    expect(markup).not.toContain("Loading working directory");
  });

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
