import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";

const MIN_PORT = 1;
const MAX_PORT = 65_535;

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    return DEFAULT_TERMINAL_WS_PORT;
  }
  return parsed;
}

export const getRuntimeConfig = createServerFn({ method: "GET" }).handler(() => ({
  terminalWsPort: parsePort(process.env.TERMINAL_WS_PORT),
}));
