import { useQuery } from "@tanstack/react-query";
import type { SessionContext } from "../../model";
import { sessionQueries } from "../../queries";

export function useSessionContext(context: Partial<SessionContext>, enabled = true) {
  const hasRepository = Boolean(context.gitRoot || context.repository);
  const { data, error } = useQuery({
    ...sessionQueries.context(context.directory),
    enabled: enabled && !hasRepository,
  });
  return {
    context: hasRepository || !data ? context : { ...data, branch: context.branch ?? data.branch },
    error: hasRepository ? null : error,
  };
}
