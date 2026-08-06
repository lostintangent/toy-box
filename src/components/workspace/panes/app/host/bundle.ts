import type { ComponentType } from "react";
import {
  APP_REGISTER_GLOBAL,
  APP_RUNTIME_GLOBAL,
  type CompiledAppBundle,
} from "@/lib/apps/runtime";
import { APP_RUNTIME_LIBRARIES } from "../runtime/libraries";

type EvaluatedAppBundle = {
  Component: ComponentType;
  css: string;
};

export function evaluateAppBundle(
  definitionId: string,
  bundle: CompiledAppBundle,
): EvaluatedAppBundle {
  let Component: ComponentType | undefined;
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  globals[APP_RUNTIME_GLOBAL] = APP_RUNTIME_LIBRARIES;
  globals[APP_REGISTER_GLOBAL] = (candidate: ComponentType) => {
    Component = candidate;
  };

  try {
    // App definitions are trusted owner-installed extensions. The server has
    // bundled their allow-listed imports into this registration boundary.
    // oxlint-disable-next-line typescript/no-implied-eval -- This is the intentional trusted-extension evaluation boundary.
    Function(bundle.code)();
  } finally {
    delete globals[APP_REGISTER_GLOBAL];
    delete globals[APP_RUNTIME_GLOBAL];
  }

  if (!Component) throw new Error(`App definition "${definitionId}" has no default component.`);
  return { Component, css: bundle.css };
}
