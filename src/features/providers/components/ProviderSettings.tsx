import { useEffect } from "react";
import { useIsMutating, useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { Check, Loader2, Minus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { providerMutations, providerQueries, type ProviderUpdateResult } from "../queries";
import { useProviders } from "../useProviders";

export function ProviderSettings() {
  const { providers, setEnabled } = useProviders();
  const updateableProviderIds = providers.flatMap(({ id, installed, enabled }) =>
    installed && enabled ? [id] : [],
  );
  const {
    mutate: updateProvider,
    status: updateStatus,
    reset: resetUpdate,
  } = useMutation(providerMutations.update());
  const isUpdating = useIsMutating({ mutationKey: providerMutations.updateKey() }) > 0;
  useEffect(() => {
    if (updateStatus === "success" || updateStatus === "error") resetUpdate();
  }, [updateStatus, resetUpdate]);

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-3 w-full">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Model Providers</span>
          <Badge variant="secondary" className="h-5 min-w-5 px-1.5 tabular-nums">
            {providers.length}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="ml-auto"
            disabled={updateableProviderIds.length === 0 || isUpdating}
            onClick={() => {
              for (const id of updateableProviderIds) updateProvider(id);
            }}
          >
            {isUpdating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Update all
          </Button>
        </div>
      </legend>
      {providers.map(({ id, name, installed, enabled }) => (
        <div key={id} className="flex min-h-6 items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={enabled}
              disabled={!installed}
              onCheckedChange={(checked) => setEnabled(id, checked)}
            />
            <span className={installed ? undefined : "text-muted-foreground"}>{name}</span>
          </label>
          {!installed && (
            <span className="ml-auto text-xs text-muted-foreground">Not installed</span>
          )}
          {installed && (
            <ProviderUpdate
              id={id}
              name={name}
              disabled={!enabled}
              onUpdate={() => updateProvider(id)}
            />
          )}
        </div>
      ))}
    </fieldset>
  );
}

function ProviderUpdate({
  id,
  name,
  disabled,
  onUpdate,
}: {
  id: string;
  name: string;
  disabled: boolean;
  onUpdate: () => void;
}) {
  const { data: version, isPending } = useQuery({
    ...providerQueries.versions(),
    select: (versions) => versions[id],
  });
  const states = useMutationState<MutationState<ProviderUpdateResult, Error, string>>({
    filters: {
      mutationKey: providerMutations.updateKey(),
      predicate: (mutation) => mutation.state.variables === id,
    },
    select: (mutation) => mutation.state,
  });
  const state = states.at(-1);

  let label = `Check and install ${name} updates`;
  let icon = <RefreshCw />;
  if (state?.status === "pending") {
    label = `Updating ${name}`;
    icon = <Loader2 className="animate-spin" />;
  } else if (state?.status === "error") {
    label = `${name} update failed`;
    icon = <X className="text-destructive" />;
  } else if (state?.data?.updated) {
    label = `${name} updated. Restart Toy Box to use this version.`;
    icon = <Check className="text-emerald-500" />;
  } else if (state?.status === "success") {
    label = `${name} version unchanged`;
    icon = <Minus />;
  }

  return (
    <>
      {isPending ? (
        <Skeleton className="h-3 w-14" />
      ) : (
        <span className="text-xs text-muted-foreground tabular-nums">
          ({version ?? "Version unavailable"})
        </span>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground"
              aria-label={label}
              disabled={disabled || state?.status === "pending"}
              onClick={onUpdate}
            />
          }
        >
          {icon}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </>
  );
}
