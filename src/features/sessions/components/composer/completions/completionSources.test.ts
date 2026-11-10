import { describe, expect, test } from "bun:test";
import { fileQueries } from "@files/queries";
import { matchCompletion } from "@/shared/composers/completions/useCompletions";
import type { Session } from "../../../model";
import { skillQueries } from "../../../queries";
import { promptCompletionSources } from "./completionSources";

const session = (id: string, updated: number, title = "Plan"): Session => ({
  id,
  title,
  createdAt: new Date(0),
  updatedAt: new Date(updated),
  provider: { id: "copilot" },
});

function catalog(source: ReturnType<typeof promptCompletionSources>[number], query: string) {
  const request = source.query(query);
  if (Array.isArray(request)) throw new Error("Expected a projection over a catalog query.");
  return request;
}

describe("prompt completion sources", () => {
  test("skills complete only at the start of a prompt", () => {
    const [{ trigger }] = promptCompletionSources({ hyperSessionId: null });
    expect(matchCompletion(trigger, "/rev", 4)).toEqual({ start: 0, end: 4, query: "rev" });
    expect(matchCompletion(trigger, "/review later", 4)).toEqual({
      start: 0,
      end: 7,
      query: "rev",
    });
    expect(matchCompletion(trigger, "/review now", 11)).toBeUndefined();
    expect(matchCompletion(trigger, "see /rev", 8)).toBeUndefined();
  });

  test("skills come from the catalog for the composer's directory and provider", () => {
    const [session] = promptCompletionSources({
      sessionId: "session",
      directory: "/project",
      provider: "codex",
      hyperSessionId: null,
    });
    expect(catalog(session!, "").queryKey).toEqual(skillQueries.list("/project", "codex").queryKey);
    // Inbox composes before a session exists.
    const [inbox] = promptCompletionSources({ provider: "claude", hyperSessionId: "hyper" });
    expect(catalog(inbox!, "").queryKey).toEqual(skillQueries.list(undefined, "claude").queryKey);
  });

  test("skills match by name or description and mark global skills within a directory", () => {
    const skills = [
      { name: "review", description: "Check a diff", type: "global", path: "/r.md" },
      { name: "deploy", description: "Ship it", type: "project" },
    ];
    const [withDirectory] = promptCompletionSources({ directory: "/p", hyperSessionId: null });
    expect(catalog(withDirectory!, "DIFF").select!(skills)).toEqual([
      {
        value: "/review",
        label: "/review",
        description: "Check a diff",
        badge: "Global",
        filePath: "/r.md",
      },
    ]);
    const [withoutDirectory] = promptCompletionSources({ hyperSessionId: null });
    expect(catalog(withoutDirectory!, "ship").select!(skills)).toMatchObject([
      { value: "/deploy", badge: undefined },
    ]);
  });

  test("sessions offer other top-level sessions by title, newest first", () => {
    const [, sessions] = promptCompletionSources({ sessionId: "self", hyperSessionId: "hyper" });
    const values = catalog(sessions!, "pLaN").select!({
      sessions: [
        session("self", 9),
        { ...session("draft", 8), provider: undefined },
        session("worker", 7),
        session("hyper", 6),
        session("older", 3),
        session("tied-b", 5),
        session("tied-a", 5),
        session("other", 4, "Other topic"),
        { ...session("untitled-plan", 2), title: undefined },
      ],
      ownership: { worker: { type: "worker", parentSessionId: "self" } },
      worktrees: {},
    }).map(({ value }) => value);
    expect(values).toEqual([
      "[Plan](session:tied-a)",
      "[Plan](session:tied-b)",
      "[Plan](session:older)",
      "[untitled-plan](session:untitled-plan)",
    ]);
  });

  test("files are referenced by their search path, named with their folder beside them", () => {
    const [, , files] = promptCompletionSources({ directory: "/p", hyperSessionId: null });
    const search = catalog(files!, "plan");
    expect(search.queryKey).toEqual(fileQueries.search("/p", "plan").queryKey);
    expect(search.select!(["src/a folder/plan.md", "plan.txt"])).toMatchObject([
      {
        value: "[plan.md](file:src/a%20folder/plan.md)",
        label: "plan.md",
        detail: "src/a folder",
      },
      { value: "[plan.txt](file:plan.txt)", label: "plan.txt", detail: undefined },
    ]);
    const [, , noDirectory] = promptCompletionSources({ hyperSessionId: null });
    expect(noDirectory!.query("plan")).toEqual([]);
  });
});
