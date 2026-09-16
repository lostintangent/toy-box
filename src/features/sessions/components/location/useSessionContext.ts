import { useQuery } from "@tanstack/react-query";
import type { SessionContext } from "../../model";
import { sessionQueries } from "../../queries";

export function useSessionContext(context: Partial<SessionContext>, enabled = true) {
  const hasGitContext = Boolean(context.gitRoot || context.repository || context.branch);
  const { data, error } = useQuery({
    ...sessionQueries.context(context.workingDirectory),
    enabled: enabled && !hasGitContext,
  });
  return {
    context: hasGitContext ? context : (data ?? context),
    error: hasGitContext ? null : error,
  };
}
