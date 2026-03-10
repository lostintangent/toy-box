import { createContext, useContext } from "react";
import type { LineDiff } from "@/hooks/diffs/useEditDiffs";

const EditDiffsContext = createContext<Map<string, LineDiff> | null>(null);

export const EditDiffsProvider = EditDiffsContext.Provider;

export function useToolCallDiff(toolCallId: string): LineDiff | undefined {
  const diffsMap = useContext(EditDiffsContext);
  return diffsMap?.get(toolCallId);
}
