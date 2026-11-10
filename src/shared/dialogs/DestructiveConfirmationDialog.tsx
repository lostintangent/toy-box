import { Loader2 } from "lucide-react";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";

export function DestructiveConfirmationDialog<TData, TContext>({
  title,
  description,
  confirmLabel = "Delete",
  pendingLabel = confirmLabel,
  disabled = false,
  mutation: mutationOptions,
  open,
  onOpenChange,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  pendingLabel?: string;
  disabled?: boolean;
  mutation: UseMutationOptions<TData, Error, void, TContext>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useMutation(mutationOptions);

  function handleConfirm() {
    mutation.mutate(undefined, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      // One kept mounted, as a nested dialog is, reopens without its last error.
      onOpenChangeComplete={(open) => {
        if (!open) mutation.reset();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={disabled || mutation.isPending}
            onClick={handleConfirm}
          >
            {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            {mutation.isPending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
