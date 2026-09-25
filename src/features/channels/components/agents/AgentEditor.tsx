import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { ChannelMember } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { OptionalModelConfigurationPicker } from "@providers/components/ModelPicker";
import type { ModelConfiguration } from "@providers/model";
import { sessionQueries } from "@sessions/queries";
import { useModels } from "@providers/useModels";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { DestructiveConfirmationDialog } from "@/shared/sidebar/DestructiveConfirmationDialog";
import { Textarea } from "@/shared/ui/textarea";
import { AgentAvatar } from "./AgentAvatar";

export function AgentEditor({ agent, onClose }: { agent: ChannelMember; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[min(50rem,calc(100vh-2rem))] overflow-y-auto sm:max-w-2xl">
        <AgentForm key={agent.id} agent={agent} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function AgentForm({ agent, onClose }: { agent: ChannelMember; onClose: () => void }) {
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role ?? "");
  const [model, setModel] = useState<ModelConfiguration | undefined>(agent.model);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { data: sessionProvider } = useQuery({
    ...sessionQueries.state(),
    select: (state) => state.sessions.find(({ id }) => id === agent.id)?.provider?.id,
  });
  const provider = sessionProvider ?? agent.model?.provider;
  const { models, defaultModel } = useModels(provider);
  const inheritedModel = !provider || defaultModel?.provider === provider ? defaultModel : null;
  const update = useMutation(channelMutations.updateAgent());

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      {
        agentId: agent.id,
        name,
        ...(role.trim() ? { role } : {}),
        model: model ?? null,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <>
      <DialogTitle className="flex items-center gap-2.5">
        <AgentAvatar name={agent.name} avatar={agent.avatar} className="size-9" />
        {agent.name}
      </DialogTitle>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" hint="Names are unique within this channel and determine mentions.">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field
          label="Role"
          hint="The member's responsibility in this channel, plus any necessary persona or behavioral details."
        >
          <Textarea
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="A direct product critic who tests assumptions against concrete user experience and explains tradeoffs clearly."
            className="min-h-32"
            required={agent.role !== undefined}
          />
        </Field>
        <div className="grid gap-1.5 text-sm font-medium">
          <span>Model</span>
          <div className="flex min-h-10 items-center gap-1 rounded-md border px-1.5">
            <OptionalModelConfigurationPicker
              models={models}
              value={model}
              inheritedValue={inheritedModel}
              onValueChange={setModel}
            />
          </div>
        </div>
        {update.error && <p className="text-sm text-destructive">{update.error.message}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="destructive-ghost"
            className="sm:mr-auto"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 /> Remove agent
          </Button>
          <Button
            type="submit"
            disabled={
              update.isPending || !name.trim() || (agent.role !== undefined && !role.trim())
            }
          >
            {update.isPending ? "Saving…" : "Save agent"}
          </Button>
        </DialogFooter>
      </form>

      {confirmingDelete && (
        <DestructiveConfirmationDialog
          title={`Remove ${agent.name}?`}
          description="This removes the agent from the channel and deletes its private session. Its channel messages and reactions remain attributed to Deleted agent."
          confirmLabel="Remove agent"
          mutation={channelMutations.removeMember(agent.id)}
          onSubmit={onClose}
          onOpenChange={setConfirmingDelete}
        />
      )}
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}
