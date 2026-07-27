import { getPathBasename } from "@/lib/paths";

/** The concise label used when a file path has a product-level name. */
export function fileName(path: string): string {
  const basename = getPathBasename(path);
  return basename === "plan.md" ? "Plan" : basename;
}
