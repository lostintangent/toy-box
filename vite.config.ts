import { defineConfig, lazyPlugins } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

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
              replacement: resolve("src/features/sessions/server/sdk/unsupportedCopilotFfi.ts"),
            },
          ]
        : [],
      tsconfigPaths: true,
    },

    plugins: lazyPlugins(() => [
      tailwindcss(),
      nitro({
        preset: "bun",
        devServer: { runner: "self" },
        serverDir: "./src/server",
        features: { websocket: isProduction },
        output: {
          publicDir: ".output/server/public",
        },
        serveStatic: isProduction,
      }),
      tanstackStart({ router: { virtualRouteConfig: "./src/routes.ts" } }),
      viteReact(),
      babel({ presets: [reactCompilerPreset()] }),
    ]),

    fmt: {
      ignorePatterns: ["src/routeTree.gen.ts"],
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
