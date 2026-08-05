import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function InstallAppDialog({
  isInstalling,
  error,
  onOpenChange,
  onInstall,
}: {
  isInstalling: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onInstall: (url: string) => void;
}) {
  const [url, setUrl] = useState("");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!isInstalling) onOpenChange(open);
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
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const value = url.trim();
            if (value) onInstall(value);
          }}
        >
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
            disabled={isInstalling}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isInstalling || !url.trim()}>
              {isInstalling && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {isInstalling ? "Installing…" : "Install"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
