import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { serializeDocument, type JsonNode, type JsonPointer } from "../../document";
import { useAgent, type AskIntent } from "../../agent";

// Directs a background worker at one node: the user says what they want, and the
// node's location and current value are attached so the agent changes exactly it
// (or adds inside it). The worker's edit returns through the ordinary file watch,
// highlighted as a diff.

const COPY: Record<
  AskIntent,
  { title: string; noun: string; placeholder: string; action: string }
> = {
  edit: {
    title: "Ask the agent",
    noun: "the change",
    placeholder: "e.g. fill in realistic sample values",
    action: "Ask agent",
  },
  add: {
    title: "Ask the agent to add",
    noun: "the new entry",
    placeholder: "e.g. add an admin user with a recent login",
    action: "Add",
  },
};

export function AskAgentDialog({
  open,
  onOpenChange,
  node,
  pointer,
  intent = "edit",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: JsonNode;
  pointer: JsonPointer;
  intent?: AskIntent;
}) {
  const { askAgent } = useAgent();
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const copy = COPY[intent];

  async function submit() {
    const trimmed = instruction.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    const asked = await askAgent({
      pointer,
      valueJson: serializeDocument(node),
      instruction: trimmed,
      intent,
    })
      .then(() => true)
      .catch((error: unknown) => {
        console.error("Unable to ask the agent:", error);
        return false;
      });
    setSubmitting(false);
    if (asked) {
      setInstruction("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            Describe {copy.noun} for{" "}
            <code className="font-mono text-foreground">
              {pointer === "" ? "the document" : pointer}
            </code>
            . The agent edits the file, and the result appears highlighted.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={3}
          value={instruction}
          placeholder={copy.placeholder}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.repeat) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!instruction.trim() || submitting}>
            {submitting ? "Working…" : copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
