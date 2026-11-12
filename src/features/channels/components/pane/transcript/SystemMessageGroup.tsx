import type { ReactNode } from "react";
import {
  CalendarClock,
  FileMinus,
  FileUp,
  Folder,
  ImageIcon,
  MonitorPlay,
  Pencil,
  UserMinus,
  UserPlus,
} from "lucide-react";
import type {
  ChannelAgentIdentity,
  ChannelMessageActor,
  ChannelRoutine,
  ChannelSystemMessage,
  ChannelSystemMessageContent,
} from "@channels/model";
import type { WorkspaceFile } from "@files/model";
import { useRevealFile } from "@files/useRevealFile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { DoneIndicator } from "@/shared/ui/done-indicator";
import { ChannelAvatar } from "@channels/components/ChannelAvatar";
import { useChannelPane } from "../ChannelPaneContext";
import { WorkspacePreview } from "@sessions/components/outputs/WorkspacePreview";

type ContentByKind = {
  [Content in ChannelSystemMessageContent as Content["type"]]: Content;
};
type SystemMessageKind = keyof ContentByKind;

/** A row's contents: one message, or a merged run that transcriptRows grouped by kind. */
type Contents<Kind extends SystemMessageKind> = [ContentByKind[Kind], ...ContentByKind[Kind][]];

type PresentationContext = {
  agent: (id: string) => ChannelAgentIdentity;
  revealFile: (file: WorkspaceFile) => void;
};

/** One system message, or a merged run of joins or of one actor's removals or artifact changes. */
export function SystemMessageGroup({ messages }: { messages: readonly ChannelSystemMessage[] }) {
  const { agent } = useChannelPane();
  const revealFile = useRevealFile();
  const { icon, content, tooltip } = presentSystemMessages(
    messages.map(({ content }) => content),
    { agent, revealFile },
  );

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

function presentSystemMessages<Kind extends SystemMessageKind>(
  [first, ...rest]: readonly (ContentByKind[Kind] & { type: Kind })[],
  context: PresentationContext,
) {
  const { icon, present } = SYSTEM_MESSAGES[first.type];
  return { icon, ...present([first, ...rest], context) };
}

const SYSTEM_MESSAGES: {
  [Kind in SystemMessageKind]: {
    icon: ReactNode;
    present: (
      contents: Contents<Kind>,
      context: PresentationContext,
    ) => { content: ReactNode; tooltip?: string };
  };
} = {
  tasks_completed: {
    icon: <DoneIndicator className="size-4 shrink-0" />,
    present: () => ({ content: "All tasks completed" }),
  },
  channel_renamed: {
    icon: <Pencil className="size-3.5 shrink-0" />,
    present: ([{ name }]) => ({
      content: (
        <>
          Channel renamed: <Value text={name} />
        </>
      ),
    }),
  },
  channel_avatar_changed: {
    icon: <ImageIcon className="size-3.5 shrink-0" />,
    present: ([{ avatar }]) => ({
      content: (
        <>
          Avatar updated: <ChannelAvatar avatar={avatar} className="size-4 align-top" />
        </>
      ),
    }),
  },
  channel_purpose_changed: {
    icon: <Pencil className="size-3.5 shrink-0" />,
    present: ([{ purpose }]) => ({
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
    present: ([{ directory }]) => ({
      content:
        directory === null ? (
          "Working directory cleared"
        ) : (
          <>
            Working directory changed: <Value text={directory} keep="end" />
          </>
        ),
    }),
  },
  preview_changed: {
    icon: <MonitorPlay className="size-3.5 shrink-0" />,
    present: ([{ preview }]) => ({
      content: preview ? (
        <>
          Preview updated: <WorkspacePreview preview={preview} variant="inline" />
        </>
      ) : (
        "Preview cleared"
      ),
    }),
  },
  member_joined: {
    icon: <UserPlus className="size-3.5 shrink-0" />,
    present: membershipContent,
  },
  member_left: {
    icon: <UserMinus className="size-3.5 shrink-0" />,
    present: membershipContent,
  },
  artifact_shared: {
    icon: <FileUp className="size-3.5 shrink-0" />,
    present: (contents, context) => artifactContent(contents, "shared", context),
  },
  artifact_removed: {
    icon: <FileMinus className="size-3.5 shrink-0" />,
    present: (contents, context) => artifactContent(contents, "removed", context),
  },
  routine_scheduled: {
    icon: <CalendarClock className="size-3.5 shrink-0" />,
    present: ([{ routine }]) => routineContent("New routine scheduled", routine),
  },
  routine_edited: {
    icon: <CalendarClock className="size-3.5 shrink-0" />,
    present: ([{ routine }]) => routineContent("Routine edited", routine),
  },
  routine_deleted: {
    icon: <CalendarClock className="size-3.5 shrink-0" />,
    present: ([{ routine }]) => routineContent("Routine deleted", routine),
  },
};

function artifactContent(
  contents: Contents<"artifact_shared" | "artifact_removed">,
  verb: "shared" | "removed",
  { agent, revealFile }: PresentationContext,
) {
  const [{ actor }] = contents;
  const artifacts = contents.map(({ artifact }) => artifact);
  return {
    content: (
      <>
        {actorName(actor, agent)} {verb}{" "}
        {artifacts.map((artifact, index) => (
          // eslint-disable-next-line react/no-array-index-key -- The same file can be shared twice in a run.
          <span key={index}>
            {index > 0 &&
              (index === artifacts.length - 1 ? (artifacts.length > 2 ? ", and " : " and ") : ", ")}
            <button
              type="button"
              title={artifact.file.path}
              className="font-medium text-foreground underline decoration-current/40 underline-offset-2 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => revealFile(artifact.file)}
            >
              {artifact.title}
            </button>
          </span>
        ))}
      </>
    ),
  };
}

const MAX_VALUE_LENGTH = 120;

/**
 * A changed value on one line of at most 120 characters, and in full on hover. A long path keeps its
 * end, where the distinguishing folders are; other values keep their start.
 */
function Value({
  text,
  title = text,
  keep = "start",
}: {
  text: string;
  title?: string;
  keep?: "start" | "end";
}) {
  const line = text.replace(/\s+/g, " ");
  const kept = MAX_VALUE_LENGTH - 3;
  return (
    <span className="font-medium text-foreground" title={title}>
      {line.length <= MAX_VALUE_LENGTH
        ? line
        : keep === "start"
          ? `${line.slice(0, kept)}...`
          : `...${line.slice(-kept)}`}
    </span>
  );
}

function actorName(actor: ChannelMessageActor, agent: PresentationContext["agent"]): string {
  return actor.type === "user" ? "You" : agent(actor.agentId).name;
}

function membershipContent(
  contents: Contents<"member_joined" | "member_left">,
  { agent }: PresentationContext,
) {
  const [first] = contents;
  const names = contents.map(({ member }) => member.name);
  const others = names.length - 1;
  const members =
    others === 0 ? names[0] : `${names[0]} and ${others} ${others === 1 ? "other" : "others"}`;
  return {
    content:
      first.type === "member_joined"
        ? `${members} joined the channel`
        : `${actorName(first.actor, agent)} removed ${members}`,
    tooltip: others > 0 ? names.join(", ") : undefined,
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
