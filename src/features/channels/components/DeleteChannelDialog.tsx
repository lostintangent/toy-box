import type { Channel } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";

export function DeleteChannelDialog({
  channel,
  onOpenChange,
}: {
  channel: Channel;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DestructiveConfirmationDialog
      title={`Delete #${channel.title}?`}
      description="This removes the shared transcript and artifact index, and deletes each member's private channel session. Files in the working directory are not deleted."
      mutation={channelMutations.delete(channel.id)}
      onOpenChange={onOpenChange}
    />
  );
}
