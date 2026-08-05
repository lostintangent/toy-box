import { useState } from "react";
import type { LeafnodeAgentRequest } from "@lostintangent/leafnode";
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
import type { EditorProps } from "../../index";
import { buildAgentPrompt, targetMetadata } from "./bridge";

export function AgentPrompt({
  onDismiss,
  request,
  spawnWorker,
}: {
  onDismiss: () => void;
  request: LeafnodeAgentRequest;
  spawnWorker: NonNullable<EditorProps["spawnWorker"]>;
}) {
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const trimmed = instruction.trim();
    if (!trimmed || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await spawnWorker({
        name: `Update ${request.pointer || "JSON document"}`,
        prompt: buildAgentPrompt({
          ...request,
          instruction: trimmed,
        }),
        metadata: targetMetadata(request.pointer),
      });
      onDismiss();
    } catch (error) {
      console.error("Unable to ask the agent:", error);
      setError("Unable to start the agent. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ask the agent</DialogTitle>
          <DialogDescription>
            Describe the change for{" "}
            <code className="font-mono text-foreground">
              {request.pointer === "" ? "the document" : request.pointer}
            </code>
            . The agent edits the file, and the result appears when it finishes.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={3}
          value={instruction}
          placeholder="e.g. add a property or fill in realistic sample values"
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.repeat) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!instruction.trim() || submitting}>
            {submitting ? "Working…" : "Ask agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
