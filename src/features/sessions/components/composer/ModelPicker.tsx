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

const TOKEN_WINDOW_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function ModelPicker({
  models,
  selectedModel,
  onModelChange,
}: {
  models: readonly ModelPickerInfo[];
  selectedModel?: string;
  onModelChange: (modelId: string) => void;
}) {
  if (models.length === 0) return null;

  const selectedModelName =
    models.find((model) => model.id === selectedModel)?.name ?? selectedModel ?? models[0].name;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
          {selectedModelName}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={selectedModel} onValueChange={onModelChange}>
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
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
          {formatReasoningEffort(reasoningEffort)}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Reasoning effort
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={reasoningEffort}
          onValueChange={(selected) => onValueChange({ ...value, reasoningEffort: selected })}
        >
          {supportedReasoningEfforts.map((effort) => (
            <DropdownMenuRadioItem key={effort} value={effort} className="text-xs">
              {formatReasoningEffort(effort)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {supportedContextTiers.length > 0 && contextTier && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Context window
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={contextTier}
              onValueChange={(selected) => onValueChange({ ...value, contextTier: selected })}
            >
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
        onModelChange={(name) =>
          onValueChange(
            resolveModelConfigurationForModel(
              models.find((candidate) => candidate.id === name),
              { ...value, name },
            ),
          )
        }
      />
      <ModelOptionsPicker model={selectedModel} value={value} onValueChange={onValueChange} />
    </>
  );
}
