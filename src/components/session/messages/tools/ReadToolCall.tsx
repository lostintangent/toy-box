import { FileText } from "lucide-react";
import type { ToolCallProps } from "./types";
import { toRelativePath } from "@/lib/utils";
import { useSessionCwd } from "@/hooks/session/SessionCwdContext";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

export function ReadToolCall({ toolCall, ...props }: ToolCallProps) {
  const cwd = useSessionCwd();
  const path =
    (toolCall.arguments.path as string) ||
    (toolCall.arguments.filePath as string) ||
    "Unknown file";

  return (
    <ToolCallCard {...props} toolCall={toolCall} icon={FileText} label={toRelativePath(path, cwd)}>
      <TextBlock maxHeight="max-h-64">{toolCall.result?.content}</TextBlock>
    </ToolCallCard>
  );
}
