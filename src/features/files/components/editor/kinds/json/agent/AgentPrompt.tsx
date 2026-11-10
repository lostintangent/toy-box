import { useState } from "react";
import type { LeafnodeAgentRequest } from "@lostintangent/leafnode";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";
import type { EditorProps } from "../../index";
import { buildAgentPrompt, targetMetadata } from "./bridge";

export function AgentPrompt({
  open,
  onOpenChange,
  request,
  spawnWorker,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: LeafnodeAgentRequest;
  spawnWorker: NonNullable<EditorProps["file"]["spawnWorker"]>;
}) {
  const [instruction, setInstruction] = useState("");
  const spawnMutation = useMutation({
    mutationFn: (trimmedInstruction: string) =>
      spawnWorker({
        name: `Update ${request.pointer || "JSON document"}`,
        prompt: buildAgentPrompt({ ...request, instruction: trimmedInstruction }),
        metadata: targetMetadata(request.pointer),
      }),
  });

  function submit() {
    const trimmed = instruction.trim();
    if (!trimmed || spawnMutation.isPending) return;

    spawnMutation.mutate(trimmed, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              submit();
            }
          }}
        />
        {spawnMutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            Unable to start the agent. Try again.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!instruction.trim() || spawnMutation.isPending}>
            {spawnMutation.isPending ? "Working…" : "Ask agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
