import { describe, expect, test } from "bun:test";
import { smallJsonSchema, SMALL_JSON_MAX_BYTES } from "./smallJson";

describe("small JSON", () => {
  test("accepts ordinary workspace metadata and rejects oversized documents", () => {
    expect(smallJsonSchema.safeParse({ cardId: "card-a", pending: true }).success).toBe(true);
    expect(smallJsonSchema.safeParse("x".repeat(SMALL_JSON_MAX_BYTES)).success).toBe(false);
  });
});
