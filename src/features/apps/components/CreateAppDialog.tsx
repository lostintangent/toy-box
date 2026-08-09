import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { appMutations } from "@apps/mutations";
import type { AppInstance } from "@apps/model";

export function CreateAppDialog({
  definitionId,
  definitionTitle,
  onOpenChange,
  onCreated,
}: {
  definitionId: string;
  definitionTitle: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (app: AppInstance) => void;
}) {
  const [title, setTitle] = useState(definitionTitle);
  const createMutation = useMutation(appMutations.create(definitionId));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;

    createMutation.mutate(value, { onSuccess: onCreated });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!createMutation.isPending) onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save a {definitionTitle} app</DialogTitle>
          <DialogDescription>This creates a durable instance with its own state.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            value={title}
            maxLength={100}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="App name"
            autoFocus
          />
          {createMutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {createMutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={createMutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !title.trim()}>
              {createMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              )}
              Save app
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
