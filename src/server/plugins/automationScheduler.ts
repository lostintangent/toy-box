import { ensureSchedulerStarted } from "@/functions/automations/scheduler";

export default function automationSchedulerPlugin(): void {
  ensureSchedulerStarted();
}
