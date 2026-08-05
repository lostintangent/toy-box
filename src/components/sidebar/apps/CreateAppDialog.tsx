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

export function CreateAppDialog({
  definitionTitle,
  isCreating,
  error,
  onOpenChange,
  onCreate,
}: {
  definitionTitle: string;
  isCreating: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState(definitionTitle);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save a {definitionTitle} app</DialogTitle>
          <DialogDescription>This creates a durable instance with its own state.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const value = title.trim();
            if (value) onCreate(value);
          }}
        >
          <Input
            value={title}
            maxLength={100}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="App name"
            autoFocus
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !title.trim()}>
              {isCreating && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              Save app
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
