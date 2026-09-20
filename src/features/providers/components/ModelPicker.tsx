import { ChevronDown } from "lucide-react";
import { Fragment } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  formatReasoningEffort,
  modelCatalogKey,
  modelConfigurationKey,
  getModelContextTierConfig,
  getModelReasoningConfig,
  resolveModelConfigurationForModel,
  type ModelConfiguration,
  type ModelInfo,
} from "../model";

const INHERIT_MODEL_VALUE = "__toy_box_inherit_model__";

const TOKEN_WINDOW_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function ModelPicker({
  models,
  selectedModel,
  inheritLabel,
  onModelChange,
}: {
  models: readonly ModelInfo[];
  selectedModel?: string;
  inheritLabel?: string;
  onModelChange: (modelId: string | undefined) => void;
}) {
  if (models.length === 0) return null;

  const selectedModelName =
    (selectedModel
      ? (models.find((model) => modelCatalogKey(model) === selectedModel)?.name ?? selectedModel)
      : inheritLabel) ?? models[0].name;
  const selectedValue = selectedModel ?? (inheritLabel ? INHERIT_MODEL_VALUE : undefined);
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const group = groups.get(model.provider);
    if (group) group.push(model);
    else groups.set(model.provider, [model]);
  }
  const selectModel = (value: string) =>
    onModelChange(value === INHERIT_MODEL_VALUE ? undefined : value);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" />}
      >
        {selectedModelName}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {inheritLabel && (
          <DropdownMenuRadioGroup value={selectedValue} onValueChange={selectModel}>
            <DropdownMenuRadioItem value={INHERIT_MODEL_VALUE} className="text-xs">
              {inheritLabel}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        )}
        {[...groups].map(([provider, group], index) => (
          <Fragment key={provider}>
            {(inheritLabel || index > 0) && <DropdownMenuSeparator />}
            <DropdownMenuRadioGroup value={selectedValue} onValueChange={selectModel}>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {group[0].providerName ?? provider}
              </DropdownMenuLabel>
              {group.map((model) => (
                <DropdownMenuRadioItem
                  key={modelCatalogKey(model)}
                  value={modelCatalogKey(model)}
                  className="text-xs"
                >
                  {model.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelOptionsPicker({
  model,
  value,
  onValueChange,
}: {
  model?: ModelInfo;
  value: ModelConfiguration;
  onValueChange: (value: ModelConfiguration) => void;
}) {
  const { supportedReasoningEfforts, reasoningEffort } = getModelReasoningConfig(
    model,
    value.reasoningEffort,
  );
  if (supportedReasoningEfforts.length === 0 || !reasoningEffort) return null;

  const { supportedContextTiers, contextTier } = getModelContextTierConfig(
    model,
    value.contextTier,
  );

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" />}
      >
        {formatReasoningEffort(reasoningEffort)}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={reasoningEffort}
          onValueChange={(selected) => onValueChange({ ...value, reasoningEffort: selected })}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Reasoning effort
          </DropdownMenuLabel>
          {supportedReasoningEfforts.map((effort) => (
            <DropdownMenuRadioItem key={effort} value={effort} className="text-xs">
              {formatReasoningEffort(effort)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {supportedContextTiers.length > 0 && contextTier && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={contextTier}
              onValueChange={(selected) => onValueChange({ ...value, contextTier: selected })}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Context window
              </DropdownMenuLabel>
              {supportedContextTiers.map(({ name, tokenWindow }) => (
                <DropdownMenuRadioItem key={name} value={name} className="text-xs">
                  {TOKEN_WINDOW_FORMATTER.format(tokenWindow)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ModelConfigurationPicker({
  models,
  value,
  onValueChange,
}: {
  models: readonly ModelInfo[];
  value: ModelConfiguration;
  onValueChange: (value: ModelConfiguration) => void;
}) {
  const selectedModel = models.find(
    (model) => modelCatalogKey(model) === modelConfigurationKey(value),
  );

  return (
    <>
      <ModelPicker
        models={models}
        selectedModel={modelConfigurationKey(value)}
        onModelChange={(name) => {
          if (!name) return;
          const selected = models.find((candidate) => modelCatalogKey(candidate) === name);
          if (!selected) return;
          onValueChange(
            resolveModelConfigurationForModel(selected, {
              ...value,
              name: selected.id,
              provider: selected.provider,
            }),
          );
        }}
      />
      <ModelOptionsPicker model={selectedModel} value={value} onValueChange={onValueChange} />
    </>
  );
}

/** Pick a durable override while preserving inheritance as an explicit domain state. */
export function OptionalModelConfigurationPicker({
  models,
  value,
  inheritedValue,
  onValueChange,
}: {
  models: readonly ModelInfo[];
  value?: ModelConfiguration;
  inheritedValue?: ModelConfiguration | null;
  onValueChange: (value: ModelConfiguration | undefined) => void;
}) {
  const selectedModel = value
    ? models.find((model) => modelCatalogKey(model) === modelConfigurationKey(value))
    : undefined;
  const inheritedName = inheritedValue
    ? (models.find((model) => modelCatalogKey(model) === modelConfigurationKey(inheritedValue))
        ?.name ?? inheritedValue.name)
    : undefined;
  const inheritLabel = inheritedName ? `Workspace default · ${inheritedName}` : "Workspace default";

  return (
    <>
      <ModelPicker
        models={models}
        selectedModel={value ? modelConfigurationKey(value) : undefined}
        inheritLabel={inheritLabel}
        onModelChange={(name) => {
          if (!name) {
            onValueChange(undefined);
            return;
          }
          const selected = models.find((candidate) => modelCatalogKey(candidate) === name);
          if (!selected) return;
          const seed = value ?? inheritedValue ?? { name: selected.id };
          onValueChange(
            resolveModelConfigurationForModel(selected, {
              ...seed,
              name: selected.id,
              provider: selected.provider,
            }),
          );
        }}
      />
      {value && (
        <ModelOptionsPicker model={selectedModel} value={value} onValueChange={onValueChange} />
      )}
    </>
  );
}
