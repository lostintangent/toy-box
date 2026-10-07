import type { ReactNode } from "react";
import {
  CalendarClock,
  FileUp,
  Folder,
  MonitorPlay,
  Pencil,
  UserMinus,
  UserPlus,
} from "lucide-react";
import {
  DELETED_AGENT_NAME,
  type ChannelAgent,
  type ChannelRoutine,
  type ChannelSystemMessage,
} from "@channels/model";
import type { WorkspaceFile } from "@files/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { DoneIndicator } from "@/shared/ui/done-indicator";
import { useChannelPane } from "../ChannelPaneContext";

type ContentByKind = {
  [Content in ChannelSystemMessage["content"] as Content["type"]]: Content;
};

type MessageContext = {
  messages: readonly ChannelSystemMessage[];
  agents: readonly ChannelAgent[];
  revealFile?: (file: WorkspaceFile) => void;
};

/** One system message, or a run of membership changes or one agent's artifact shares, merged. */
export function SystemMessageGroup({ messages }: { messages: readonly ChannelSystemMessage[] }) {
  const { agents } = useChannelPane();
  const { revealFile } = useWorkspaceSurface();
  const { icon, content, tooltip } = systemMessagePresentation(messages, agents, revealFile);

  // The icon sits in the avatar column, so events read as part of the conversation.
  const body = (
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex w-8 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0">{content}</span>
    </span>
  );

  return (
    <div className="flex text-xs text-muted-foreground">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            {body}
          </TooltipTrigger>
          <TooltipContent sideOffset={4} className="max-w-72">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        body
      )}
    </div>
  );
}

/** Presents an already-grouped row; transcriptRows owns which messages belong together. */
export function systemMessagePresentation<Kind extends keyof ContentByKind>(
  messages: readonly (Omit<ChannelSystemMessage, "content"> & {
    content: ContentByKind[Kind] & { type: Kind };
  })[],
  agents: readonly ChannelAgent[],
  revealFile?: (file: WorkspaceFile) => void,
) {
  const message = messages[0]!.content;
  const { icon, content } = SYSTEM_MESSAGES[message.type];
  return { icon, ...content(message, { messages, agents, revealFile }) };
}

const SYSTEM_MESSAGES: {
  [Kind in keyof ContentByKind]: {
    icon: ReactNode;
    content: (
      message: ContentByKind[Kind],
      context: MessageContext,
    ) => { content: ReactNode; tooltip?: string };
  };
} = {
  tasks_completed: {
    icon: <DoneIndicator className="size-4 shrink-0" />,
    content: () => ({ content: "All tasks completed" }),
  },
  channel_renamed: {
    icon: <Pencil className="size-3.5 shrink-0" />,
    content: ({ name }) => ({
      content: (
        <>
          Channel renamed: <Value text={name} />
        </>
      ),
    }),
  },
  channel_purpose_changed: {
    icon: <Pencil className="size-3.5 shrink-0" />,
    content: ({ purpose }) => ({
      content:
        purpose === null ? (
          "Purpose cleared"
        ) : (
          <>
            Purpose updated: <Value text={purpose} />
          </>
        ),
    }),
  },
  channel_directory_changed: {
    icon: <Folder className="size-3.5 shrink-0" />,
    content: ({ directory }) => ({
      // A long path keeps its end, where the distinguishing folders are.
      content:
        directory === null ? (
          "Working directory cleared"
        ) : (
          <>
            Working directory changed:{" "}
            <Value
              text={directory.length > 120 ? `...${directory.slice(-117)}` : directory}
              title={directory}
            />
          </>
        ),
    }),
  },
  preview_changed: {
    icon: <MonitorPlay className="size-3.5 shrink-0" />,
    content: ({ previewUrl }) => ({
      content: previewUrl ? (
        <>
          Preview updated:{" "}
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            <Value text={previewUrl} />
          </a>
        </>
      ) : (
        "Preview cleared"
      ),
    }),
  },
  member_joined: {
    icon: <UserPlus className="size-3.5 shrink-0" />,
    content: (_message, { messages }) => membershipContent(messages, true),
  },
  member_left: {
    icon: <UserMinus className="size-3.5 shrink-0" />,
    content: (_message, { messages }) => membershipContent(messages, false),
  },
  artifact_shared: {
    icon: <FileUp className="size-3.5 shrink-0" />,
    content: ({ actor }, { messages, agents, revealFile }) => {
      const actorName =
        actor.type === "user"
          ? "You"
          : (agents.find(({ id }) => id === actor.agentId)?.name ?? DELETED_AGENT_NAME);
      const artifacts = messages.flatMap(({ id, content }) =>
        content.type === "artifact_shared" ? [{ id, ...content.artifact }] : [],
      );
      return {
        content: (
          <>
            {actorName} shared{" "}
            {artifacts.map((artifact, index) => (
              <span key={artifact.id}>
                {index > 0 &&
                  (index === artifacts.length - 1
                    ? artifacts.length > 2
                      ? ", and "
                      : " and "
                    : ", ")}
                <button
                  type="button"
                  title={artifact.file.path}
                  className="font-medium text-foreground underline decoration-current/40 underline-offset-2 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => revealFile?.(artifact.file)}
                >
                  {artifact.title}
                </button>
              </span>
            ))}
          </>
        ),
      };
    },
  },
  routine_scheduled: {
    icon: <CalendarClock className="size-3.5 shrink-0" />,
    content: ({ routine }) => routineContent("New routine scheduled", routine),
  },
  routine_edited: {
    icon: <CalendarClock className="size-3.5 shrink-0" />,
    content: ({ routine }) => routineContent("Routine edited", routine),
  },
  routine_deleted: {
    icon: <CalendarClock className="size-3.5 shrink-0" />,
    content: ({ routine }) => routineContent("Routine deleted", routine),
  },
};

/** A changed value on one line of at most 120 characters, and in full on hover. */
function Value({ text, title = text }: { text: string; title?: string }) {
  const line = text.replace(/\s+/g, " ");
  return (
    <span className="font-medium text-foreground" title={title}>
      {line.length > 120 ? `${line.slice(0, 117)}...` : line}
    </span>
  );
}

function membershipContent(messages: readonly ChannelSystemMessage[], joined: boolean) {
  const names = messages.flatMap(({ content }) =>
    content.type === "member_joined" || content.type === "member_left" ? [content.member.name] : [],
  );
  const name = names[0] ?? DELETED_AGENT_NAME;
  const action = joined ? "joined" : "left";
  const others = names.length - 1;
  return {
    content:
      names.length === 1
        ? `${name} ${action} the channel`
        : `${name} and ${others} ${others === 1 ? "other" : "others"} ${action} the channel`,
    tooltip: names.length > 1 ? names.join(", ") : undefined,
  };
}

function routineContent(label: string, { title, schedule, prompt }: ChannelRoutine) {
  return {
    content: (
      <>
        {label}: <Value text={title} title={`${schedule}\n${prompt}`} />
      </>
    ),
  };
}
