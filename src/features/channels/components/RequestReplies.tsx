import { Button } from "@/shared/ui/button";

/** A pending request's suggested replies, each answering it with its label. */
export function RequestReplies({
  replies,
  onReply,
}: {
  replies: readonly string[];
  onReply: (reply: string) => void;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {replies.map((label) => (
        <Button key={label} variant="outline" size="sm" onClick={() => onReply(label)}>
          {label}
        </Button>
      ))}
    </div>
  );
}
