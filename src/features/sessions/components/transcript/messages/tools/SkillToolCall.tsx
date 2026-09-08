import { BookOpenText } from "lucide-react";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { Button } from "@/shared/components/ui/button";
import { ToolCallCard } from "./ToolCallCard";
import type { ToolCallProps } from "./types";

export function SkillToolCall({ toolCall, ...props }: ToolCallProps) {
  const { openFile } = useWorkspaceSurface();
  const name = typeof toolCall.arguments.skill === "string" ? toolCall.arguments.skill : "Unknown";
  const path = typeof toolCall.arguments.path === "string" ? toolCall.arguments.path : undefined;
  const skillName =
    path && openFile ? (
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-xs font-normal"
        aria-label={`Open ${name} skill file`}
        title="Open SKILL.md"
        onClick={() => openFile(path)}
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
