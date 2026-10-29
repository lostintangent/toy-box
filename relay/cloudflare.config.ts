import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "toy-box-push-relay",
    compatibilityDate: "2026-10-23",
    entrypoint,
    workersDev: true,
    previewUrls: true,
    observability: { enabled: false },
  },
});
