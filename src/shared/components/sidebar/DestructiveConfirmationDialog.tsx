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
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

export function DestructiveConfirmationDialog<TData, TContext>({
  title,
  description,
  confirmLabel = "Delete",
  pendingLabel = confirmLabel,
  disabled = false,
  mutation: mutationOptions,
  onSubmit,
  onOpenChange,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  pendingLabel?: string;
  disabled?: boolean;
  mutation: UseMutationOptions<TData, Error, void, TContext>;
  onSubmit?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useMutation(mutationOptions);

  function handleConfirm() {
    onSubmit?.();
    mutation.mutate(undefined, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
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
