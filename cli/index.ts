#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import open from "open";

import { version } from "../package.json";

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}

const main = defineCommand({
  meta: {
    name: "Toy Box",
    version,
    description: "Self-hosted web client for GitHub Copilot",
  },
  args: {
    cwd: {
      type: "positional",
      required: false,
      description: "Working directory to start the server in",
    },
    port: {
      type: "string",
      alias: "p",
      default: "3000",
      description: "Port to listen on",
    },
    host: {
      type: "string",
      alias: "H",
      default: "0.0.0.0",
      description: "Host to bind to",
    },
    "no-open": {
      type: "boolean",
      default: false,
      description: "Don't open the browser automatically",
    },
  },
  async run({ args }) {
    process.env.NODE_ENV = "production";

    process.env.NITRO_PORT = args.port;
    process.env.NITRO_HOST = args.host;

    // The compiled binary is sometimes invoked as a subprocess by SDK internals
    // with a file path in argv[2]. Only treat positional cwd as valid when it's a directory.
    if (args.cwd && (await isDirectory(args.cwd))) {
      process.chdir(args.cwd);
    }

    // Start the Nitro server.
    // @ts-expect-error - built output has no types
    await import("../.output/server/index.mjs");

    const shouldOpenBrowser = args["no-open"] === false && process.stdout.isTTY;
    if (shouldOpenBrowser) {
      void open(`http://localhost:${args.port}`).catch((error) => {
        console.error("Unable to open browser:", error);
      });
    }
  },
});

await runMain(main);
