import { type Connect, defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { resolve } from "node:path";
import { constants } from "node:zlib";
import compression from "compression";
import tailwindcss from "@tailwindcss/vite";
import { removeUncompressedAssets } from "./src/cli/build/publicAssets";
import { socketDevelopment } from "./src/server/socketDevelopment";

export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";

  return {
    server: {
      host: "::",
      allowedHosts: [".ts.net"],
    },

    // These two libraries are only used on the server, and therefore,
    // don't need to be optimized for EJS by Vite during development.
    optimizeDeps: {
      exclude: ["@tailwindcss/oxide", "app-typescript"],
    },

    resolve: {
      alias: isProduction
        ? [
            {
              find: /^koffi$/,
              replacement: resolve(
                "src/features/providers/server/copilot/unsupportedCopilotFfi.ts",
              ),
            },
          ]
        : [],
      tsconfigPaths: true,
    },

    plugins: [
      tailwindcss(),
      socketDevelopment(),
      {
        name: "toy-box:dev-compression",
        apply: "serve",
        configureServer(server) {
          server.middlewares.use(
            compression({
              level: 1,
              brotli: { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } },
              // Vite owns these assets; Nitro owns HTML, JSON, and live streams.
              filter: (_request, response) =>
                /^(?:text\/(?:javascript|css)|application\/javascript)(?:;|$)/i.test(
                  String(response.getHeader("Content-Type") ?? ""),
                ),
            }) as Connect.NextHandleFunction,
          );
        },
      },
      nitro({
        preset: "bun",
        devServer: { runner: "self" },
        serverDir: "./src/server",
        features: { websocket: isProduction },
        output: {
          publicDir: ".output/server/public",
        },
        serveStatic: isProduction,
        compressPublicAssets: { gzip: true, brotli: true },
        hooks: {
          "rollup:before"(nitro, config) {
            if (nitro.options.dev) return;
            config.plugins = [
              config.plugins,
              {
                name: "toy-box:compressed-public-assets",
                // Nitro copies and compresses assets before bundling its server.
                // Prune here so its generated manifest only references retained files.
                buildStart: () => removeUncompressedAssets(nitro.options.output.publicDir),
              },
            ];
          },
        },
      }),
      tanstackStart({
        router: {
          entry: "./features/workspace/router",
          routesDirectory: "features/workspace/routes",
          generatedRouteTree: "features/workspace/routeTree.gen.ts",
          virtualRouteConfig: "./src/features/workspace/routes.ts",
        },
      }),
      viteReact({ compiler: true }),
    ],
  };
});
