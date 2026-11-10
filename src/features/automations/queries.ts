import { reducedQuery } from "@/shared/query";
import { reduceAutomationList } from "./model/catalog";
import { listAutomations } from "./server/functions";

export const automationQueries = {
  list: reducedQuery({
    queryKey: ["automations", "list"],
    fetch: ({ signal }) => listAutomations({ signal }),
    reduce: reduceAutomationList,
  }),
};
