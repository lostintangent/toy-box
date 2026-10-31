import { screenRuntime } from "./runtime";

/** The helper's open pipes would keep the server running, so it closes with the server. */
export default function startScreens() {
  return () => screenRuntime.dispose();
}
