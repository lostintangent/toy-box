import { createServerFn } from "@tanstack/react-start";
import { getProviderCatalog as readProviderCatalog } from "./index";

export const getProviderCatalog = createServerFn({ method: "GET" }).handler(() =>
  readProviderCatalog(),
);
