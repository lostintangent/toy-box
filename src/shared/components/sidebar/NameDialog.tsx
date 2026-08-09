import { useId, useState, type FormEvent } from "react";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
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

export function NameDialog<TData, TContext>({
  name,
  title,
  description,
  submitLabel = "Save",
  mutation: mutationOptions,
  onOpenChange,
}: {
  name: string;
  title: string;
  description: string;
  submitLabel?: string;
  mutation: UseMutationOptions<TData, Error, string, TContext>;
  onOpenChange: (open: boolean) => void;
}) {
  const inputId = useId();
  const [nextName, setNextName] = useState(name);
  const mutation = useMutation(mutationOptions);
  const trimmedName = nextName.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    trimmedName.length <= 100 &&
    trimmedName !== name.trim() &&
    !mutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    mutation.mutate(trimmedName, { onSuccess: () => onOpenChange(false) });
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
              onChange={(event) => setNextName(event.target.value)}
              autoFocus
            />
          </div>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
