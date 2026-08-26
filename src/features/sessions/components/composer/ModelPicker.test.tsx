import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DropdownMenuSeparator } from "@/shared/components/ui/dropdown-menu";
import type { ModelConfiguration } from "../../model/modelConfiguration";
import { ModelConfigurationPicker } from "./ModelPicker";

type PickerModel = Parameters<typeof ModelConfigurationPicker>[0]["models"][number];
const CONTEXT_TIERS = [
  { name: "default", tokenWindow: 264_000 },
  { name: "future_tier", tokenWindow: 1_000_000 },
] as const;

function model(overrides: Partial<PickerModel> = {}): PickerModel {
  return {
    id: "gpt-5",
    name: "GPT-5",
    ...overrides,
  };
}

function renderPicker(selectedModel: PickerModel, value: ModelConfiguration) {
  return renderToStaticMarkup(
    <ModelConfigurationPicker models={[selectedModel]} value={value} onValueChange={() => {}} />,
  );
}

function renderOptionsPicker(
  selectedModel: PickerModel,
  value: ModelConfiguration,
  onValueChange: (value: ModelConfiguration) => void = () => {},
) {
  const picker = ModelConfigurationPicker({
    models: [selectedModel],
    value,
    onValueChange,
  }) as ReactElement<{ children: ReactNode }>;
  const optionsPicker = Children.toArray(picker.props.children)[1];
  if (!isValidElement(optionsPicker) || typeof optionsPicker.type !== "function") {
    throw new Error("ModelConfigurationPicker did not render its options control.");
  }
  const element = optionsPicker as ReactElement<Record<string, unknown>>;
  const Component = element.type as (props: Record<string, unknown>) => ReactNode;
  return Component(element.props);
}

describe("ModelConfigurationPicker", () => {
  test("renders a reasoning-only summary and group", () => {
    const selectedModel = model({
      supportedReasoningEfforts: ["low", "future_effort"],
      defaultReasoningEffort: "future_effort",
    });
    const value = { name: selectedModel.id };

    const optionsPicker = renderOptionsPicker(selectedModel, value);
    const text = collectText(optionsPicker);
    expect(renderPicker(selectedModel, value)).toContain("Future Effort");
    expect(text).toContain("Reasoning effort");
    expect(text).not.toContain("Context window");
    expect(countElements(optionsPicker, DropdownMenuSeparator)).toBe(0);
  });

  test("renders reasoning before context with a reasoning-only trigger and one separator", () => {
    const selectedModel = model({
      supportedReasoningEfforts: ["high"],
      defaultReasoningEffort: "high",
      supportedContextTiers: CONTEXT_TIERS,
    });
    const value = { name: selectedModel.id };

    const optionsPicker = renderOptionsPicker(selectedModel, value);
    const trigger = renderPicker(selectedModel, value);
    const text = collectText(optionsPicker);
    expect(trigger).toContain("High");
    expect(trigger).not.toContain("264K");
    expect(trigger).not.toContain("1M");
    expect(countElements(optionsPicker, DropdownMenuSeparator)).toBe(1);
    expect(text.indexOf("Reasoning effort")).toBeLessThan(text.indexOf("Context window"));
    expect(text).toContain("264K");
    expect(text).toContain("1M");
    expect(text).not.toMatch(/Default|Future Tier/);
  });

  test("updates one option without dropping the other configuration", () => {
    const selectedModel = model({
      supportedReasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "high",
      supportedContextTiers: CONTEXT_TIERS,
    });
    const value = {
      name: selectedModel.id,
      reasoningEffort: "high",
      contextTier: "future_tier",
      futureOption: "preserved",
    };
    const changes: ModelConfiguration[] = [];
    const optionChanges = collectOptionChanges(
      renderOptionsPicker(selectedModel, value, (configuration) => changes.push(configuration)),
    );

    optionChanges[0]?.("low");
    optionChanges[1]?.("default");

    expect(changes).toEqual([
      {
        ...value,
        reasoningEffort: "low",
      },
      {
        ...value,
        contextTier: "default",
      },
    ]);
  });
});

function countElements(node: ReactNode, type: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((count, child) => count + countElements(child, type), 0);
  }
  if (!isValidElement(node)) return 0;

  const element = node as ReactElement<{ children?: ReactNode }>;
  return (element.type === type ? 1 : 0) + countElements(element.props.children, type);
}

function collectText(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (typeof node === "string") return node;
  if (!isValidElement(node)) return "";

  return collectText((node as ReactElement<{ children?: ReactNode }>).props.children);
}

function collectOptionChanges(node: ReactNode): Array<(value: string) => void> {
  if (Array.isArray(node)) {
    return node.flatMap(collectOptionChanges);
  }
  if (!isValidElement(node)) return [];

  const element = node as ReactElement<{
    children?: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }>;
  const control =
    typeof element.props.value === "string" && element.props.onValueChange
      ? [element.props.onValueChange]
      : [];
  return [...control, ...collectOptionChanges(element.props.children)];
}
