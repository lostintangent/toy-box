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

/** Closes as it starts its mutation, so any optimistic hide and repair belong to the mutation's
 *  own options. */
export function DestructiveConfirmationDialog<TData, TContext>({
  title,
  description,
  confirmLabel = "Delete",
  disabled = false,
  mutation: mutationOptions,
  open,
  onOpenChange,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  disabled?: boolean;
  mutation: UseMutationOptions<TData, Error, void, TContext>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useMutation(mutationOptions);

  function handleConfirm() {
    mutation.mutate();
    onOpenChange(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={disabled || mutation.isPending}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
