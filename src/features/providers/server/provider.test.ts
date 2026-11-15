import { expect, test } from "bun:test";
import { z } from "zod";
import { toolInputSchema } from "./provider";

test("tool input schemas drop validation-only noise and keep real constraints", () => {
  const parameters = z.object({
    dueAt: z.iso.datetime().optional(),
    count: z.number().int(),
    index: z.number().int().nonnegative(),
    color: z.string().regex(/^#[0-9a-f]{6}$/),
    path: z.string().startsWith("/"),
    tag: z.string().transform((tag) => tag.toLowerCase()),
    name: z.string().min(1).max(80),
    sequence: z.number().int().positive(),
    scores: z.record(z.string(), z.number()).optional(),
  });
  expect(toolInputSchema(parameters)).toEqual({
    type: "object",
    properties: {
      dueAt: { type: "string", format: "date-time" },
      count: { type: "integer" },
      index: { type: "integer", minimum: 0 },
      color: { type: "string", pattern: "^#[0-9a-f]{6}$" },
      path: { type: "string", format: "starts_with", pattern: "^\\/.*" },
      tag: { type: "string" },
      name: { type: "string", maxLength: 80 },
      sequence: { type: "integer" },
      scores: { type: "object", additionalProperties: { type: "number" } },
    },
    required: ["count", "index", "color", "path", "tag", "name", "sequence"],
  });
});
