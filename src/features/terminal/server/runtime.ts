import { PTYManager } from "./pty";

// Keep process-global construction separate from the testable PTY lifecycle.
export const terminalRuntime = new PTYManager();
