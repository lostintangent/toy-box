import { useContext, type ReactNode } from "react";
import { defaultRemarkPlugins, type Components } from "streamdown";
import { splitAgentMentionText } from "@channels/model";
import { Markdown } from "@/shared/ui/markdown";
import { cn } from "@/shared/utils";
import { ChannelPaneContext } from "../pane/ChannelPaneContext";

const MENTION_TAG = "agent-mention";
const ARTIFACT_LINK_TAG = "artifact-link";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  data?: {
    hName: string;
    hProperties: Record<string, string>;
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

/** Hands every `file:` link to `ArtifactLink`, since Markdown blocks links outside the web's
 *  schemes. */
function remarkArtifactLinks() {
  const decorate = (node: MarkdownNode): void => {
    if (node.type === "link" && node.url?.toLowerCase().startsWith("file:")) {
      node.data = { hName: ARTIFACT_LINK_TAG, hProperties: { reference: node.url } };
    }
    node.children?.forEach(decorate);
  };
  return decorate;
}

/** A `file:` link to a shared artifact, styled as Markdown's links, or else its label as text, as it
 *  is outside a Channel pane. */
function ArtifactLink({
  children,
  reference,
}: {
  [key: string]: unknown;
  children?: ReactNode;
  reference?: string;
}) {
  const pane = useContext(ChannelPaneContext);
  const open = reference ? pane?.openArtifactLink(reference) : undefined;
  return open ? (
    <button
      type="button"
      data-streamdown="link"
      className="wrap-anywhere appearance-none text-left font-medium text-primary underline"
      onClick={open}
    >
      {children}
    </button>
  ) : (
    children
  );
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

const remarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkAgentMentions,
  remarkArtifactLinks,
];
const allowedTags = { [MENTION_TAG]: ["handle"], [ARTIFACT_LINK_TAG]: ["reference"] };
const components = {
  [MENTION_TAG]: Mention,
  [ARTIFACT_LINK_TAG]: ArtifactLink,
} satisfies Components;
const accentComponents = { ...components, [MENTION_TAG]: AccentMention } satisfies Components;

/** Markdown whose operational agent mentions render distinctly from ordinary text, and whose
 *  `file:` links open the shared artifacts they name. */
export function AgentMentionMarkdown({
  content,
  onAccent = false,
}: {
  content: string;
  onAccent?: boolean;
}) {
  return (
    <Markdown
      preserveLineBreaks
      remarkPlugins={remarkPlugins}
      allowedTags={allowedTags}
      components={onAccent ? accentComponents : components}
    >
      {content}
    </Markdown>
  );
}
