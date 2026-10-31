import { Fragment, useEffect, useState } from "react";
import { useIsMutating, useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { Check, ChevronRight, Clock3, Loader2, Minus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { ProgressBar } from "@/shared/ui/progress-bar";
import { RelativeTime } from "@/shared/ui/relative-time";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/utils";
import { providerMutations, providerQueries, type ProviderUpdateResult } from "../queries";
import { useProviders } from "../useProviders";

export function ProviderSettings() {
  const { providers, setEnabled } = useProviders();
  const updateableProviderIds = providers.flatMap(({ id, enabled }) => (enabled ? [id] : []));
  // Limits stay collapsed so the provider list reads at a glance.
  const [isShowingUsage, setIsShowingUsage] = useState(false);
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
          <Badge variant="count">{providers.length}</Badge>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="ml-auto"
            aria-expanded={isShowingUsage}
            onClick={() => setIsShowingUsage(!isShowingUsage)}
          >
            <ChevronRight className={cn("transition-transform", isShowingUsage && "rotate-90")} />
            Usage
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
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
      {providers.map(({ id, name, status, enabled }) => (
        <div key={id} className="grid gap-1">
          <div className="flex min-h-6 items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={enabled}
                disabled={status === "unavailable"}
                onCheckedChange={(checked) => setEnabled(id, checked)}
              />
              <span className={status === "ready" ? undefined : "text-muted-foreground"}>
                {name}
              </span>
            </label>
            {status === "unavailable" && (
              <span className="ml-auto text-xs text-muted-foreground">Not installed</span>
            )}
            {status !== "unavailable" && <ProviderVersion id={id} />}
            {status === "signedOut" && (
              <span className="text-xs text-muted-foreground">Signed out</span>
            )}
            {status === "ready" && enabled && <ProviderPlan id={id} />}
            {status !== "unavailable" && (
              <ProviderUpdate
                id={id}
                name={name}
                disabled={!enabled}
                onUpdate={() => updateProvider(id)}
              />
            )}
          </div>
          {isShowingUsage && status === "ready" && enabled && <ProviderPlanLimits id={id} />}
        </div>
      ))}
    </fieldset>
  );
}

function ProviderVersion({ id }: { id: string }) {
  const { data: version, isPending } = useQuery({
    ...providerQueries.versions(),
    select: (versions) => versions[id],
  });
  return isPending ? (
    <Skeleton className="h-3 w-14" />
  ) : (
    <span className="text-xs text-muted-foreground tabular-nums">
      ({version ?? "Version unavailable"})
    </span>
  );
}

function ProviderPlan({ id }: { id: string }) {
  const { data: plan } = useQuery({
    ...providerQueries.subscription(id),
    select: (subscription) => subscription?.plan,
  });
  return plan ? (
    <Badge variant="metadata" className="capitalize">
      {plan.replaceAll("_", " ")}
    </Badge>
  ) : null;
}

/** How much of each of its plan's limits the account has used, beneath its provider. */
function ProviderPlanLimits({ id }: { id: string }) {
  const {
    data: limits,
    isPending,
    isError,
  } = useQuery({
    ...providerQueries.subscription(id),
    select: (subscription) => subscription?.limits ?? [],
  });
  if (isPending) return <Skeleton className="ml-6 h-3 w-40" />;
  if (isError) return <span className="ml-6 text-xs text-muted-foreground">Usage unavailable</span>;
  if (limits.length === 0) return null;

  return (
    <div className="ml-6 grid w-fit grid-cols-[auto_auto] items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {limits.map((limit) => (
        <Fragment key={limit.name}>
          <span>{limit.name}</span>
          <span className="flex items-center gap-2">
            <ProgressBar value={limit.usedPercent / 100} className="w-20" />
            <span className="tabular-nums">{Math.round(limit.usedPercent)}%</span>
            {limit.resetsAt && (
              <Badge variant="metadata">
                <Clock3 className="h-3 w-3 shrink-0" />
                <RelativeTime date={new Date(limit.resetsAt)} />
              </Badge>
            )}
          </span>
        </Fragment>
      ))}
    </div>
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
  );
}
