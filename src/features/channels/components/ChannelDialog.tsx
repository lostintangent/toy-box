import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Hash, Loader2 } from "lucide-react";
import { createChannelInputSchema, editChannelInputSchema, type Channel } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { ModelConfigurationPicker } from "@providers/components/ModelPicker";
import { areModelConfigurationsEqual, type ModelConfiguration } from "@providers/model";
import { useModels } from "@providers/useModels";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { SessionLocationPicker } from "@sessions/components/location/SessionLocationPicker";
import { getRecentDirectories } from "@sessions/model/recentDirectories";
import { sessionQueries } from "@sessions/queries";

type ChannelDialogProps =
  | {
      channel?: never;
      onOpenChange: (open: boolean) => void;
      onCreated: (channelId: string) => void;
    }
  | {
      channel: Channel;
      onOpenChange: (open: boolean) => void;
      onCreated?: never;
    };

export function ChannelDialog({ channel, onOpenChange, onCreated }: ChannelDialogProps) {
  const [initialChannel] = useState(channel);
  const [name, setName] = useState(initialChannel?.name ?? "");
  const [purpose, setPurpose] = useState(initialChannel?.purpose ?? "");
  const [directory, setDirectory] = useState<string | null | undefined>();
  const [model, setModel] = useState<ModelConfiguration | undefined>(initialChannel?.model);
  const create = useMutation(channelMutations.create());
  const edit = useMutation(channelMutations.edit());
  const { isPending, error } = initialChannel ? edit : create;
  const { models, defaultModel } = useModels(initialChannel?.model.provider);
  const { data: recentDirectory } = useQuery({
    ...sessionQueries.state(),
    select: (state) => getRecentDirectories(state.sessions)[0]?.cwd,
  });
  const effectiveDirectory = directory === null ? undefined : (directory ?? recentDirectory);
  const effectiveModel = model ?? defaultModel;
  const nextName = name.trim();
  const nextPurpose = purpose.trim();
  const input = initialChannel
    ? editChannelInputSchema.safeParse({
        channelId: initialChannel.id,
        ...(nextName !== initialChannel.name ? { name: nextName } : {}),
        ...(nextPurpose !== (initialChannel.purpose ?? "") ? { purpose: nextPurpose || null } : {}),
        ...(effectiveModel && !areModelConfigurationsEqual(effectiveModel, initialChannel.model)
          ? { model: effectiveModel }
          : {}),
      })
    : createChannelInputSchema.safeParse({
        name: nextName,
        purpose: nextPurpose || undefined,
        directory: effectiveDirectory,
        model: effectiveModel,
      });
  const canSubmit = input.success && !isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.success || isPending) return;
    if ("channelId" in input.data) {
      edit.mutate(input.data, { onSuccess: () => onOpenChange(false) });
    } else {
      create.mutate(input.data, {
        onSuccess: (created) => {
          onOpenChange(false);
          onCreated?.(created.id);
        },
      });
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(50rem,calc(100vh-2rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="size-5 text-cyan-600" />{" "}
            {initialChannel ? "Edit channel" : "New channel"}
          </DialogTitle>
          <DialogDescription>
            {initialChannel
              ? "Update the channel and its lead. Name and purpose changes appear in the conversation."
              : "Give the channel a purpose, or let its lead ask what you want to work on. The lead brings in members when their specialization helps."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="min-w-0 space-y-5">
          <label className="grid gap-1.5 text-sm font-medium">
            Channel name
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Launch review"
              maxLength={100}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>
              Purpose <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <Textarea
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="Work through checkout UX paper cuts"
              rows={3}
              maxLength={12_000}
            />
          </label>
          <div className="grid gap-1.5 text-sm font-medium">
            <span>Lead model</span>
            {effectiveModel && models.length > 0 ? (
              <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-1 rounded-md border px-2">
                <ModelConfigurationPicker
                  models={models}
                  value={effectiveModel}
                  onValueChange={setModel}
                />
              </div>
            ) : effectiveModel ? (
              <div className="flex min-h-10 items-center rounded-md border px-3 text-xs font-normal text-muted-foreground">
                {effectiveModel.name} (model catalog unavailable)
              </div>
            ) : (
              <span className="text-xs font-normal text-muted-foreground">
                No models are available.
              </span>
            )}
            {initialChannel && (
              <span className="text-xs font-normal text-muted-foreground">
                The lead stays with its current provider. Model changes apply when it next starts
                work.
              </span>
            )}
          </div>
          <div className="grid gap-1.5 text-sm font-medium">
            <span>Working directory</span>
            <div className="flex min-h-10 min-w-0 items-center rounded-md border px-2">
              <SessionLocationPicker
                value={channel ? (channel.directory ?? null) : directory}
                {...(initialChannel ? {} : { onValueChange: setDirectory })}
                className="min-w-0 flex-1 justify-start"
              />
            </div>
            <span className="text-xs font-normal text-muted-foreground">
              {initialChannel
                ? "Only the lead can change the working directory. Existing agents switch on their next execution."
                : "The lead and members share this project context. Leave it empty for a discussion-only channel."}
            </span>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {isPending && <Loader2 className="animate-spin" />}
              {initialChannel
                ? isPending
                  ? "Saving…"
                  : "Save channel"
                : isPending
                  ? "Creating…"
                  : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
