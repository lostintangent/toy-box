// Cron schedules in local time. Browser validation and server scheduling share one parser, so they
// always agree on what a schedule means.

import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

export const cronSchema = z
  .string()
  .trim()
  .min(1)
  .refine((cron) => {
    try {
      CronExpressionParser.parse(cron);
      return true;
    } catch {
      return false;
    }
  }, "Invalid cron definition");

/** The first occurrence after `from`. */
export function nextCronOccurrence(cron: string, from: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: from }).next().toDate();
}
