import { getPathBasename } from "@/lib/paths";

/** The concise label used when an artifact path has a product-level name. */
export function artifactName(path: string): string {
  const basename = getPathBasename(path);
  return basename === "plan.md" ? "Plan" : basename;
}
