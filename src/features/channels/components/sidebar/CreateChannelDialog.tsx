import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Hash, Loader2 } from "lucide-react";
import { channelMutations } from "@channels/mutations";
import { ModelConfigurationPicker } from "@providers/components/ModelPicker";
import type { ModelConfiguration } from "@providers/model";
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

export function CreateChannelDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (channelId: string) => void;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [directory, setDirectory] = useState<string | null | undefined>();
  const [model, setModel] = useState<ModelConfiguration>();
  const create = useMutation(channelMutations.create());
  const { models, defaultModel } = useModels();
  const { data: recentDirectory } = useQuery({
    ...sessionQueries.state(),
    select: (state) => getRecentDirectories(state.sessions)[0]?.cwd,
  });
  const effectiveDirectory = directory === null ? undefined : (directory ?? recentDirectory);
  const effectiveModel = model ?? defaultModel;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!effectiveModel) return;
    const channel = await create.mutateAsync({
      name,
      ...(purpose.trim() ? { purpose } : {}),
      ...(effectiveDirectory ? { directory: effectiveDirectory } : {}),
      model: effectiveModel,
    });
    onOpenChange(false);
    onCreated(channel.id);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="size-5 text-cyan-600" /> New channel
          </DialogTitle>
          <DialogDescription>
            Give the channel a purpose, or let its lead ask what you want to work on. The lead
            brings in members when their specialization helps.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="min-w-0 space-y-5">
          <label className="grid gap-1.5 text-sm font-medium">
            Channel name
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Launch review"
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
            />
          </label>
          <div className="grid gap-1.5 text-sm font-medium">
            <span>Lead model</span>
            {effectiveModel ? (
              <div className="flex flex-wrap items-center gap-2">
                <ModelConfigurationPicker
                  models={models}
                  value={effectiveModel}
                  onValueChange={setModel}
                />
              </div>
            ) : (
              <span className="text-xs font-normal text-muted-foreground">
                No models are available.
              </span>
            )}
          </div>
          <div className="grid gap-1.5 text-sm font-medium">
            <span>Working directory</span>
            <div className="flex min-h-10 min-w-0 items-center rounded-md border px-2">
              <SessionLocationPicker
                value={directory}
                onValueChange={setDirectory}
                className="min-w-0 flex-1 justify-start"
              />
            </div>
            <span className="text-xs font-normal text-muted-foreground">
              The lead and members share this project context. Leave it empty for a discussion-only
              channel.
            </span>
          </div>
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || !effectiveModel || create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              {create.isPending ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
