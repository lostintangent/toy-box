import { useId, useState, type FormEvent } from "react";
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

export function NameDialog({
  name,
  title,
  description,
  submitLabel = "Save",
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  name: string;
  title: string;
  description: string;
  submitLabel?: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const inputId = useId();
  const [nextName, setNextName] = useState(name);
  const [error, setError] = useState("");
  const trimmedName = nextName.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    trimmedName.length <= 100 &&
    trimmedName !== name.trim() &&
    !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    try {
      await onSubmit(trimmedName);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save.");
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              Name
            </label>
            <Input
              id={inputId}
              value={nextName}
              maxLength={100}
              onChange={(event) => {
                setNextName(event.target.value);
                setError("");
              }}
              autoFocus
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
