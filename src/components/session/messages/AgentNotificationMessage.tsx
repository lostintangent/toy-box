import { Pencil, type LucideIcon } from "lucide-react";
import { RelativeTime } from "@/components/ui/relative-time";
import type {
  AgentNotification,
  AgentNotificationMessage as AgentNotificationMessageType,
} from "@/types";
import { notificationLabel } from "@/lib/session/agentNotifications";

const NOTIFICATION_ICONS: Record<AgentNotification["type"], LucideIcon> = {
  artifact_edited: Pencil,
};

export function AgentNotificationMessage({ message }: { message: AgentNotificationMessageType }) {
  const Icon = NOTIFICATION_ICONS[message.notification.type];

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex max-w-full items-center gap-2 rounded-lg border bg-muted/60 px-3 py-2 text-muted-foreground @md:max-w-[80%]">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <p className="truncate text-sm italic">{notificationLabel(message.notification)}</p>
      </div>
      {message.timestamp && (
        <RelativeTime className="text-xs text-muted-foreground" date={message.timestamp} />
      )}
    </div>
  );
}
