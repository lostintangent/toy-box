import { z } from "zod";

export const diffStatsSchema = z
  .object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  })
  .strict();

export type DiffStats = z.output<typeof diffStatsSchema>;
