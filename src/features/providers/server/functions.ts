import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  getProviderCatalog as readProviderCatalog,
  getSessionProvider,
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
  .validator(zodValidator(z.string()))
  .handler(({ data }) => cli.updateProvider(getSessionProvider(data).id));
