import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createInitialSessionState } from "./model/reducer";
import { sessionQueries } from "./queries";
import { warmSessionSnapshotQuery } from "./useWarmSessionSnapshots";

describe("warm session snapshot retention", () => {
  test("a pin retains an opened snapshot without watching or fetching it", async () => {
    const queryClient = createQueryClient();
    let requests = 0;
    const queryFn = async () => {
      requests++;
      return createInitialSessionState();
    };
    const options = { ...warmSessionSnapshotQuery("pinned-session"), queryFn };
    const pin = new QueryObserver(queryClient, options);
    const unpin = pin.subscribe(() => {});
    onTestFinished(unpin);

    await queryClient.invalidateQueries({ queryKey: options.queryKey });
    expect(requests).toBe(0);

    const pane = new QueryObserver(queryClient, {
      ...sessionQueries.detail("pinned-session"),
      queryFn,
    });
    const closePane = pane.subscribe(() => {});
    onTestFinished(closePane);
    await pane.getCurrentQuery().promise;
    expect(requests).toBe(1);

    closePane();
    await collectGarbage();
    expect(queryClient.getQueryData(options.queryKey)).toBeDefined();
    await queryClient.invalidateQueries({ queryKey: options.queryKey });
    expect(requests).toBe(1);

    const closeReopenedPane = pane.subscribe(() => {});
    onTestFinished(closeReopenedPane);
    await pane.getCurrentQuery().promise;
    expect(requests).toBe(2);
    closeReopenedPane();

    unpin();
    await collectGarbage();
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
  });
});

function createQueryClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  onTestFinished(() => client.clear());
  return client;
}

function collectGarbage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
