import { createServerFn } from "@tanstack/react-start";
import { screenRuntime } from "./runtime";

export const listScreens = createServerFn({ method: "GET" }).handler(() => screenRuntime.list());
