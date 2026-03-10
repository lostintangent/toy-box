import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig(({ mode }) => {
  const isProduction = mode === "production";
  return {
    server: {
      host: "::",
      allowedHosts: [".ts.net"],
    },
    plugins: [
      tailwindcss(),
      nitro({
        preset: "bun",
        plugins: ["./src/server/plugins/automationScheduler.ts"],
        features: {
          websocket: true,
        },
        serveStatic: isProduction ? "inline" : false, // Inline only for production
        rollupConfig: {
          onwarn(warning, defaultHandler) {
            if (
              warning.code === "MODULE_LEVEL_DIRECTIVE" &&
              warning.message.includes("use client")
            ) {
              return;
            }
            if (
              warning.plugin === "unwasm" &&
              warning.message.includes("Failed to load the WebAssembly module")
            ) {
              return;
            }
            defaultHandler(warning);
          },
        },
      }),
      viteTsConfigPaths({
        projects: ["./tsconfig.json"],
      }),
      tanstackStart(),
      viteReact(),
    ],
  };
});

export default config;
