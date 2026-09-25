import { type Connect, defineConfig, lazyPlugins } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { resolve } from "node:path";
import { constants } from "node:zlib";
import compression from "compression";
import tailwindcss from "@tailwindcss/vite";
import { removeUncompressedAssets } from "./cli/build/publicAssets";

export default defineConfig(({ mode }) => {
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

    plugins: lazyPlugins(() => [
      tailwindcss(),
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
    ]),

    fmt: {
      ignorePatterns: ["src/features/workspace/routeTree.gen.ts"],
    },

    staged: {
      "*.{ts,tsx,json,md,css,html}": "vp check --fix",
    },

    lint: {
      plugins: ["react", "typescript", "import"],
      jsPlugins: [
        "./.oxlint/react.js",
        "@tanstack/eslint-plugin-query",
        "@tanstack/eslint-plugin-router",
      ],
      env: {
        browser: true,
      },
      rules: {
        "react/jsx-key": "error",
        "react/no-array-index-key": "warn",
        "react/jsx-no-undef": "error",
        "react/react-compiler": [
          "error",
          {
            reportAllBailouts: true,
          },
        ],
        "toy-box-react/no-manual-memoization": "error",
        "@tanstack/query/exhaustive-deps": "error",
        "@tanstack/query/no-rest-destructuring": "warn",
        "@tanstack/query/stable-query-client": "error",
        "@tanstack/query/no-unstable-deps": "error",
        "@tanstack/query/infinite-query-property-order": "error",
        "@tanstack/query/no-void-query-fn": "error",
        "@tanstack/query/mutation-property-order": "error",
        "@tanstack/router/create-route-property-order": "warn",
        "@tanstack/router/route-param-names": "error",
      },
      overrides: [
        {
          files: ["**/*.test.{js,ts,tsx}"],
          rules: {
            "typescript/await-thenable": "off",
            "typescript/no-floating-promises": [
              "warn",
              {
                allowForKnownSafeCalls: [
                  {
                    from: "package",
                    name: "module",
                    package: "bun-types",
                  },
                ],
              },
            ],
          },
        },
      ],
      options: {
        typeAware: true,
        typeCheck: true,
      },
    },
  };
});
