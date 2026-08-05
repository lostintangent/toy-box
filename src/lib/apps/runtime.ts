/** Versioned compiler/host bridge used to load apps against Toy Box's shared runtime. */
export const APP_RUNTIME_GLOBAL = "__TOYBOX_APP_RUNTIME_V1__";
export const APP_REGISTER_GLOBAL = "__TOYBOX_APP_REGISTER_V1__";

export const APP_DEPENDENCIES = {
  react: { runtime: "React", typePackage: "@types/react" },
  "react/compiler-runtime": { runtime: "ReactCompilerRuntime" },
  "react/jsx-runtime": { runtime: "JsxRuntime" },
  "react/jsx-dev-runtime": { runtime: "JsxDevRuntime" },
  "@toy-box/sdk": { runtime: "AppSdk" },
  "lucide-react": { runtime: "Icons" },
  zod: { runtime: "Zod", typePackage: "zod" },
} as const;

export type AppDependency = keyof typeof APP_DEPENDENCIES;
export type AppRuntime = Record<(typeof APP_DEPENDENCIES)[AppDependency]["runtime"], unknown>;

export type CompiledAppBundle = {
  code: string;
  css: string;
};
