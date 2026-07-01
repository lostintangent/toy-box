import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";

// Temporary workaround for TanStack Start/Nitro dev asset routing on non-localhost
// HTTP origins when browsers omit `Sec-Fetch-Dest`, causing Vite CSS/JS requests to
// fall through to Nitro and return 404s. Remove once upstream fixes this behavior:
// https://github.com/TanStack/router/issues/7095
function inferAssetFetchDestination(): Plugin {
  return {
    name: "infer-asset-fetch-destination",
    configureServer({ middlewares }) {
      middlewares.use((req, res, next) => {
        res.setHeader("Cache-Control", "no-store");

        if (typeof req.headers["sec-fetch-dest"] === "string" || !req.url) {
          next();
          return;
        }

        const pathname = new URL(req.url, "http://vite.local").pathname;
        const accept = req.headers.accept ?? "";

        if (accept.includes("text/css") || pathname.endsWith(".css")) {
          req.headers["sec-fetch-dest"] = "style";
        } else if (
          pathname.endsWith(".js") ||
          pathname.endsWith(".mjs") ||
          pathname.endsWith(".ts") ||
          pathname.endsWith(".tsx") ||
          pathname.endsWith(".jsx")
        ) {
          req.headers["sec-fetch-dest"] = "script";
        }

        next();
      });
    },
  };
}

const config = defineConfig(({ mode }) => {
  const isProduction = mode === "production";
  return {
    server: {
      host: "::",
      allowedHosts: [".ts.net"],
      headers: {
        "Cache-Control": "no-store",
      },
    },
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [
      inferAssetFetchDestination(),
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
      tanstackStart(),
      viteReact(),
    ],
  };
});

export default config;
