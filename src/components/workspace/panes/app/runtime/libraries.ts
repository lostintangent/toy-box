import * as React from "react";
import * as ReactCompilerRuntime from "react/compiler-runtime";
import * as JsxRuntime from "react/jsx-runtime";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import * as Zod from "zod";
import type { AppRuntime } from "@/lib/apps/runtime";
import * as AppSdk from "./sdk";
import { APP_ICONS } from "./icons";

/** Browser implementations of every library available to compiled apps. */
export const APP_RUNTIME_LIBRARIES = {
  React,
  ReactCompilerRuntime,
  JsxRuntime,
  // Bun follows the server process mode when choosing a JSX transform.
  // Production React leaves jsxDEV undefined, so make a dev-transformed
  // bundle safe to render if server and browser modes differ.
  JsxDevRuntime: {
    ...JsxDevRuntime,
    jsxDEV: typeof JsxDevRuntime.jsxDEV === "function" ? JsxDevRuntime.jsxDEV : JsxRuntime.jsx,
  },
  AppSdk: AppSdk satisfies typeof import("@/lib/apps/sdk"),
  Icons: APP_ICONS,
  Zod,
} satisfies AppRuntime;
