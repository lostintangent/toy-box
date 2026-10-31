import { terminalRuntime } from "./runtime";

/** Live PTYs would outlive the server, so they close with it. */
export default function startTerminal() {
  return () => terminalRuntime.dispose();
}
