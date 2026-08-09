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

export function InstallAppDialog({
  onOpenChange,
  onInstalled,
}: {
  onOpenChange: (open: boolean) => void;
  onInstalled: (app: AppInstance) => void;
}) {
  const [url, setUrl] = useState("");
  const installMutation = useMutation(appMutations.install());

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;

    installMutation.mutate(value, { onSuccess: ({ app }) => onInstalled(app) });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!installMutation.isPending) onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install from Gist</DialogTitle>
          <DialogDescription>
            Enter a public GitHub Gist URL containing app.json and app.tsx. Apps run as trusted code
            inside Toy Box, so only install Gists you trust.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://gist.github.com/…"
            aria-label="Gist URL"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={installMutation.isPending}
          />
          {installMutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {installMutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={installMutation.isPending || !url.trim()}>
              {installMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              )}
              {installMutation.isPending ? "Installing…" : "Install"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
