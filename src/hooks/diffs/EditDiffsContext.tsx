import { createContext, useContext } from "react";
import type { DiffStats } from "@/hooks/diffs/useEditDiffs";

const EditDiffsContext = createContext<Map<string, DiffStats> | null>(null);

export const EditDiffsProvider = EditDiffsContext.Provider;

export function useToolCallDiff(toolCallId: string): DiffStats | undefined {
  const diffsMap = useContext(EditDiffsContext);
  return diffsMap?.get(toolCallId);
}
