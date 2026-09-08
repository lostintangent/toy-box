import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Hash, Loader2 } from "lucide-react";
import { channelMutations } from "@channels/mutations";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
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
  const [title, setTitle] = useState("");
  const [directory, setDirectory] = useState<string | null | undefined>();
  const create = useMutation(channelMutations.create());
  const { data: recentDirectory } = useQuery({
    ...sessionQueries.state(),
    select: (state) => getRecentDirectories(state.sessions)[0]?.cwd,
  });
  const effectiveDirectory = directory === null ? undefined : (directory ?? recentDirectory);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const channel = await create.mutateAsync({
      title,
      ...(effectiveDirectory ? { directory: effectiveDirectory } : {}),
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
            A channel keeps the public team conversation clean while every agent works in its own
            private, resumable session.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="min-w-0 space-y-5">
          <label className="grid gap-1.5 text-sm font-medium">
            Channel name
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Launch review"
              required
            />
          </label>
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
              Members share this project context. You can also leave it empty for a discussion-only
              channel.
            </span>
          </div>
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />}
              {create.isPending ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
