import type { ReactNode } from "react";
import { defaultRemarkPlugins, Streamdown, type Components } from "streamdown";
import { splitAgentMentionText } from "@agents/model";
import { cn } from "@/shared/utils";

const MENTION_TAG = "agent-mention";

type MarkdownNode = {
  type: string;
  value?: string;
  data?: {
    hName: typeof MENTION_TAG;
    hProperties: { handle: string };
  };
  children?: MarkdownNode[];
};

function remarkAgentMentions() {
  return (root: MarkdownNode) => decorateAgentMentions(root);
}

function decorateAgentMentions(node: MarkdownNode): void {
  if (!node.children || node.type === "link" || node.type === "linkReference") return;

  node.children = node.children.flatMap((child) => {
    if (child.type !== "text" || child.value === undefined) {
      decorateAgentMentions(child);
      return child;
    }

    const segments = splitAgentMentionText(child.value);
    if (segments.length === 1 && segments[0]?.type === "text") return child;

    return segments.map<MarkdownNode>((segment) =>
      segment.type === "text"
        ? { type: "text", value: segment.content }
        : {
            type: "text",
            value: segment.content,
            data: {
              hName: MENTION_TAG,
              hProperties: { handle: segment.handle },
            },
          },
    );
  });
}

type MentionProps = {
  [key: string]: unknown;
  children?: ReactNode;
  handle?: string;
};

function Mention({ children, handle, onAccent = false }: MentionProps & { onAccent?: boolean }) {
  return (
    <span
      data-agent-mention={handle}
      className={cn(
        "rounded px-1 py-0.5 font-semibold",
        onAccent
          ? "bg-primary-foreground/15 text-primary-foreground"
          : "bg-cyan-500/12 text-cyan-800 ring-1 ring-inset ring-cyan-500/20 dark:text-cyan-200",
      )}
    >
      {children}
    </span>
  );
}

function AccentMention(props: MentionProps) {
  return <Mention {...props} onAccent />;
}

const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkAgentMentions];
const allowedTags = { [MENTION_TAG]: ["handle"] };
const components = { [MENTION_TAG]: Mention } satisfies Components;
const accentComponents = { [MENTION_TAG]: AccentMention } satisfies Components;

/** Render message content with operational Agent mentions distinguished from ordinary text. */
export function AgentMention({
  content,
  onAccent = false,
}: {
  content: string;
  onAccent?: boolean;
}) {
  return (
    <Streamdown
      remarkPlugins={remarkPlugins}
      allowedTags={allowedTags}
      components={onAccent ? accentComponents : components}
      className={cn(
        "whitespace-pre-wrap text-sm [&_ol]:my-1.5 [&_p]:my-1.5 [&_pre]:my-2 [&_ul]:my-1.5",
        onAccent &&
          "[&_[data-streamdown=link]]:text-primary-foreground [&_[data-streamdown=inline-code]]:bg-primary-foreground/15",
      )}
    >
      {content}
    </Streamdown>
  );
}
