import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SessionMetadata } from "@/types";

export function RenameSessionDialog({
  open,
  session,
  isSubmitting,
  onOpenChange,
  onRenameSession,
}: {
  open: boolean;
  session: SessionMetadata | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onRenameSession: (input: { sessionId: string; name: string }) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <RenameSessionForm
          session={session}
          isSubmitting={isSubmitting}
          onOpenChange={onOpenChange}
          onRenameSession={onRenameSession}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameSessionForm({
  session,
  isSubmitting,
  onOpenChange,
  onRenameSession,
}: {
  session: SessionMetadata | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onRenameSession: (input: { sessionId: string; name: string }) => Promise<void>;
}) {
  const inputId = useId();
  const [name, setName] = useState(session?.summary ?? "");
  const [error, setError] = useState("");

  const trimmedName = name.trim();
  const currentName = session?.summary?.trim() ?? "";
  const canSubmit =
    Boolean(session) &&
    trimmedName.length > 0 &&
    trimmedName.length <= 100 &&
    trimmedName !== currentName &&
    !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !canSubmit) return;

    try {
      await onRenameSession({ sessionId: session.sessionId, name: trimmedName });
      onOpenChange(false);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename session.");
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Rename session</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          Name
        </label>
        <Input
          id={inputId}
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
          placeholder="Session name"
          autoFocus
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={!canSubmit}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
