import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Minus, RefreshCw, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { providerQueries } from "../queries";
import { updateProvider } from "../server/functions";
import { useProviders } from "../useProviders";

export function ProviderSettings() {
  const { providers, setEnabled } = useProviders();

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-3 text-sm font-medium">Model Providers</legend>
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
          {installed && <ProviderUpdate id={id} name={name} disabled={!enabled} />}
        </div>
      ))}
    </fieldset>
  );
}

function ProviderUpdate({ id, name, disabled }: { id: string; name: string; disabled: boolean }) {
  const { data: version, isPending } = useQuery({
    ...providerQueries.versions(),
    select: (versions) => versions[id],
  });
  const { mutate, status, data, reset } = useMutation({
    mutationFn: () => updateProvider({ data: id }),
    onSuccess: (result, _variables, _onMutateResult, { client }) => {
      client.setQueryData(providerQueries.versions().queryKey, (versions) => ({
        ...versions,
        [id]: result.version,
      }));
    },
  });

  useEffect(() => {
    if (status !== "success" && status !== "error") return;
    const timer = setTimeout(reset, 3000);
    return () => clearTimeout(timer);
  }, [status, reset]);

  let label = `Check and install ${name} updates`;
  let icon = <RefreshCw />;
  if (status === "pending") {
    label = `Updating ${name}`;
    icon = <Loader2 className="animate-spin" />;
  } else if (status === "error") {
    label = `${name} update failed`;
    icon = <X className="text-destructive" />;
  } else if (data?.updated) {
    label = `${name} updated. Restart Toy Box to use this version.`;
    icon = <Check className="text-emerald-500" />;
  } else if (data) {
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
              disabled={disabled || status === "pending"}
              onClick={() => mutate()}
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
