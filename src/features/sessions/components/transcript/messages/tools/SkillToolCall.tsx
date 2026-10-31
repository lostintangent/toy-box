import { BookOpenText } from "lucide-react";
import { machineFile } from "@files/model";
import { useRevealFile } from "@files/useRevealFile";
import { Button } from "@/shared/ui/button";
import { ToolCallCard } from "./ToolCallCard";
import type { ToolCallProps } from "./types";

export function SkillToolCall({ toolCall, ...props }: ToolCallProps) {
  const revealFile = useRevealFile();
  const name = typeof toolCall.arguments.skill === "string" ? toolCall.arguments.skill : "Unknown";
  const path = typeof toolCall.arguments.path === "string" ? toolCall.arguments.path : undefined;
  const skillName = path ? (
    <Button
      type="button"
      variant="link"
      className="h-auto p-0 text-xs font-normal"
      aria-label={`Open ${name} skill file`}
      title="Open SKILL.md"
      onClick={() => revealFile(machineFile(path))}
    >
      {name}
    </Button>
  ) : (
    name
  );

  return (
    <ToolCallCard
      {...props}
      toolCall={toolCall}
      icon={BookOpenText}
      label={<>Skill ({skillName})</>}
    />
  );
}
