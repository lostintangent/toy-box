import { ChevronDown } from "lucide-react";
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
import type { ModelConfiguration, ModelOptionInfo } from "../../model/modelConfiguration";
import {
  formatReasoningEffort,
  getModelContextTierConfig,
  getModelReasoningConfig,
  resolveModelConfigurationForModel,
} from "../../model/modelConfiguration";

type ModelPickerInfo = ModelOptionInfo & {
  id: string;
  name: string;
};

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
  models: readonly ModelPickerInfo[];
  selectedModel?: string;
  inheritLabel?: string;
  onModelChange: (modelId: string | undefined) => void;
}) {
  if (models.length === 0) return null;

  const selectedModelName =
    (selectedModel
      ? (models.find((model) => model.id === selectedModel)?.name ?? selectedModel)
      : inheritLabel) ?? models[0].name;
  const selectedValue = selectedModel ?? (inheritLabel ? INHERIT_MODEL_VALUE : undefined);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" />}
      >
        {selectedModelName}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={selectedValue}
          onValueChange={(value) =>
            onModelChange(value === INHERIT_MODEL_VALUE ? undefined : value)
          }
        >
          {inheritLabel && (
            <>
              <DropdownMenuRadioItem value={INHERIT_MODEL_VALUE} className="text-xs">
                {inheritLabel}
              </DropdownMenuRadioItem>
              <DropdownMenuSeparator />
            </>
          )}
          {models.map((model) => (
            <DropdownMenuRadioItem key={model.id} value={model.id} className="text-xs">
              {model.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelOptionsPicker({
  model,
  value,
  onValueChange,
}: {
  model?: ModelPickerInfo;
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
  models: readonly ModelPickerInfo[];
  value: ModelConfiguration;
  onValueChange: (value: ModelConfiguration) => void;
}) {
  const selectedModel = models.find((model) => model.id === value.name);

  return (
    <>
      <ModelPicker
        models={models}
        selectedModel={value.name}
        onModelChange={(name) => {
          if (!name) return;
          onValueChange(
            resolveModelConfigurationForModel(
              models.find((candidate) => candidate.id === name),
              { ...value, name },
            ),
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
  models: readonly ModelPickerInfo[];
  value?: ModelConfiguration;
  inheritedValue?: ModelConfiguration | null;
  onValueChange: (value: ModelConfiguration | undefined) => void;
}) {
  const selectedModel = value ? models.find((model) => model.id === value.name) : undefined;
  const inheritedName = inheritedValue
    ? (models.find((model) => model.id === inheritedValue.name)?.name ?? inheritedValue.name)
    : undefined;
  const inheritLabel = inheritedName ? `Workspace default · ${inheritedName}` : "Workspace default";

  return (
    <>
      <ModelPicker
        models={models}
        selectedModel={value?.name}
        inheritLabel={inheritLabel}
        onModelChange={(name) => {
          if (!name) {
            onValueChange(undefined);
            return;
          }
          const seed = value ?? inheritedValue ?? { name };
          onValueChange(
            resolveModelConfigurationForModel(
              models.find((candidate) => candidate.id === name),
              { ...seed, name },
            ),
          );
        }}
      />
      {value && (
        <ModelOptionsPicker model={selectedModel} value={value} onValueChange={onValueChange} />
      )}
    </>
  );
}
