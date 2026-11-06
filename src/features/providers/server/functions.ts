import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getProviderCatalog as readProviderCatalog,
  getSessionProvider,
  updateProvider as runProviderUpdate,
  sessionProviders,
} from "./index";
import * as cli from "./cli";

export const getProviderCatalog = createServerFn({ method: "GET" }).handler(() =>
  readProviderCatalog(),
);

export const getProviderVersions = createServerFn({ method: "GET" }).handler(
  async (): Promise<Record<string, string | undefined>> =>
    Object.fromEntries(
      await Promise.all(
        sessionProviders
          .filter(({ id }) => cli.isInstalled(id))
          .map(async ({ id }) => [id, await cli.readVersion(id).catch(() => undefined)]),
      ),
    ),
);

export const updateProvider = createServerFn({ method: "POST" })
  .validator(z.string())
  .handler(({ data }) => runProviderUpdate(data));

export const getProviderSubscription = createServerFn({ method: "GET" })
  .validator(z.string())
  // Query data cannot be undefined, so an account without a subscription reads as null.
  .handler(async ({ data }) => (await getSessionProvider(data).readSubscription()) ?? null);
