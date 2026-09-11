import type { z } from "zod";
import type { IntentEntityId } from "./schema";

/**
 * The refinement primitives every semantic validator shares: the narrow issue
 * sink each rule writes to, plus the two structural complaints (uniqueness and
 * unknown references) that would otherwise be restated in each owner.
 */

export type RefinementContext = Pick<z.RefinementCtx, "addIssue">;

export function addDuplicateIssues(
  values: readonly string[],
  ctx: RefinementContext,
  path: PropertyKey[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const item of values) {
    if (seen.has(item)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be unique; found "${item}".`,
        path,
      });
    }
    seen.add(item);
  }
}

export function addEntityReferenceIssue(
  entityId: IntentEntityId,
  knownEntities: ReadonlySet<string>,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  if (knownEntities.has(entityId)) return;
  ctx.addIssue({
    code: "custom",
    message: `Unknown entity reference "${entityId}".`,
    path,
  });
}
