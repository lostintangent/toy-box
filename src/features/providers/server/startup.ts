import { listModels, stopProviders } from "./index";

/**
 * Start the shared native processes before the first session-list request needs
 * them. Discovery runs in the background so a failure still registers the stop.
 */
export default function startProviders() {
  void listModels().catch((error) => console.error("Unable to discover session providers:", error));
  return stopProviders;
}
