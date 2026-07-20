import { ensureWorkersSwept } from "@/functions/runtime/workers";

export default function workerCleanupPlugin(): void {
  void ensureWorkersSwept().catch((error) => {
    console.error("Unable to sweep abandoned workers:", error);
  });
}
