import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ModelInfo, type ModelConfiguration } from "@/types";
import {
  formatReasoningEffort,
  getModelReasoningConfig,
  resolveModelConfigurationForModel,
} from "@/lib/modelConfiguration";

export interface ModelPickerProps {
  models: ModelInfo[];
  selectedModel?: string;
  onModelChange: (modelId: string) => void;
}

export function ModelPicker({ models, selectedModel, onModelChange }: ModelPickerProps) {
  if (models.length === 0) return null;

  const selectedModelName =
    models.find((model) => model.id === selectedModel)?.name ?? selectedModel ?? models[0].name;

  return (
    <DropdownMenu>
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

export interface ReasoningEffortPickerProps {
  model?: ModelInfo;
  selectedReasoningEffort?: string;
  onReasoningEffortChange: (reasoningEffort: string | undefined) => void;
}

export function ReasoningEffortPicker({
  model,
  selectedReasoningEffort,
  onReasoningEffortChange,
}: ReasoningEffortPickerProps) {
  const { supportedReasoningEfforts, reasoningEffort: displayedReasoningEffort } =
    getModelReasoningConfig(model, selectedReasoningEffort);
  if (supportedReasoningEfforts.length === 0 || !displayedReasoningEffort) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
          {formatReasoningEffort(displayedReasoningEffort)}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={displayedReasoningEffort}
          onValueChange={onReasoningEffortChange}
        >
          {supportedReasoningEfforts.map((effort) => (
            <DropdownMenuRadioItem key={effort} value={effort} className="text-xs">
              {formatReasoningEffort(effort)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ModelConfigurationPickerProps {
  models: ModelInfo[];
  value: ModelConfiguration;
  onValueChange: (value: ModelConfiguration) => void;
}

export function ModelConfigurationPicker({
  models,
  value,
  onValueChange,
}: ModelConfigurationPickerProps) {
  const selectedModel = models.find((model) => model.id === value.model);

  return (
    <>
      <ModelPicker
        models={models}
        selectedModel={value.model}
        onModelChange={(model) =>
          onValueChange(
            resolveModelConfigurationForModel(
              models.find((candidate) => candidate.id === model),
              { ...value, model },
            ),
          )
        }
      />
      <ReasoningEffortPicker
        model={selectedModel}
        selectedReasoningEffort={value.reasoningEffort}
        onReasoningEffortChange={(reasoningEffort) => onValueChange({ ...value, reasoningEffort })}
      />
    </>
  );
}
