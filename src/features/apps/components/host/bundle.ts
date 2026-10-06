import type { ComponentType } from "react";
import { APP_RUNTIME_PARAMETER, type CompiledAppBundle } from "@apps/runtime";
import { APP_RUNTIME_LIBRARIES } from "../runtime/libraries";

type EvaluatedAppBundle = {
  Component: ComponentType;
  css: string;
};

export function evaluateAppBundle(sourceId: string, bundle: CompiledAppBundle): EvaluatedAppBundle {
  const module: { exports: { default?: ComponentType } } = { exports: {} };
  // Trusted app code receives the host's shared libraries through a local binding.
  // oxlint-disable-next-line typescript/no-implied-eval -- This is the intentional trusted-extension evaluation boundary.
  Function(
    "module",
    "exports",
    APP_RUNTIME_PARAMETER,
    bundle.code,
  )(module, module.exports, APP_RUNTIME_LIBRARIES);
  const Component = module.exports.default;
  if (!Component) throw new Error(`App source "${sourceId}" has no default component.`);
  return { Component, css: bundle.css };
}
