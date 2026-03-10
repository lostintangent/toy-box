import { Search } from "lucide-react";
import type { ToolCallProps } from "./types";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";
import { useSessionCwd } from "@/hooks/session/SessionCwdContext";
import { toRelativePath } from "@/lib/utils";

export function GlobToolCall({ toolCall, ...props }: ToolCallProps) {
  const cwd = useSessionCwd();
  const pattern =
    (toolCall.arguments.glob as string) ||
    (toolCall.arguments.pattern as string) ||
    (toolCall.arguments.query as string) ||
    "Unknown pattern";

  const searchPath = toolCall.arguments.path as string;

  return (
    <ToolCallCard {...props} toolCall={toolCall} icon={Search} label={pattern}>
      <TextBlock title="Path">{searchPath ? toRelativePath(searchPath, cwd) : undefined}</TextBlock>
      <TextBlock title="Results" maxHeight="max-h-64">
        {toolCall.result?.content}
      </TextBlock>
    </ToolCallCard>
  );
}
