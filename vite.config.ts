import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig(({ mode }) => {
  const isProduction = mode === "production";
  return {
    server: {
      host: "::",
      allowedHosts: [".ts.net"],
      proxy: {
        "/terminal": {
          target: `ws://127.0.0.1:${process.env.TERMINAL_WS_PORT ?? 3101}`,
          ws: true,
        },
      },
    },
    optimizeDeps: {
      exclude: ["@tailwindcss/oxide"],
    },
    resolve: {
      alias: isProduction
        ? [
            {
              find: /^koffi$/,
              replacement: resolve("src/functions/sdk/unsupportedCopilotFfi.ts"),
            },
          ]
        : [],
      tsconfigPaths: true,
    },
    plugins: [
      tailwindcss(),
      nitro({
        preset: "bun",
        serverDir: "./src/server",
        features: { websocket: isProduction },
        output: {
          publicDir: ".output/server/public",
        },
        serveStatic: isProduction,
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
      tanstackStart(),
      viteReact(),
      isProduction && babel({ presets: [reactCompilerPreset()] }),
    ],
  };
});

export default config;
