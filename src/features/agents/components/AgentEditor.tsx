import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Brain, Trash2 } from "lucide-react";
import type { Agent, AgentExperience } from "@agents/model";
import { agentMutations } from "@agents/mutations";
import { agentQueries } from "@agents/queries";
import { OptionalModelConfigurationPicker } from "@sessions/components/composer/ModelPicker";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import { useModels } from "@sessions/useModels";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { AgentAvatar } from "./AgentAvatar";

export function AgentEditor({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { data: agents } = useSuspenseQuery(agentQueries.list());
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) return null;
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

function AgentForm({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [name, setName] = useState(agent.name);
  const [persona, setPersona] = useState(agent.persona ?? "");
  const [model, setModel] = useState<ModelConfiguration | undefined>(agent.model);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { models, defaultModel } = useModels();
  const update = useMutation(agentMutations.update());

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      {
        agentId: agent.id,
        name,
        ...(persona.trim() ? { persona } : {}),
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
        <Field label="Name" hint="Names are unique and determine how this Agent is mentioned.">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field
          label="Persona"
          hint="Its durable role, perspective, personality, and way of working. The Agent may refine this over time."
        >
          <Textarea
            value={persona}
            onChange={(event) => setPersona(event.target.value)}
            placeholder="A direct product critic who tests assumptions against concrete user experience and explains tradeoffs clearly."
            className="min-h-32"
            required={agent.persona !== undefined}
          />
        </Field>
        <div className="grid gap-1.5 text-sm font-medium">
          <span>Model</span>
          <div className="flex min-h-10 items-center gap-1 rounded-md border px-1.5">
            <OptionalModelConfigurationPicker
              models={models}
              value={model}
              inheritedValue={defaultModel}
              onValueChange={setModel}
            />
          </div>
        </div>
        {update.error && <p className="text-sm text-destructive">{update.error.message}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 /> Delete Agent
          </Button>
          <Button
            type="submit"
            disabled={
              update.isPending || !name.trim() || (agent.persona !== undefined && !persona.trim())
            }
          >
            {update.isPending ? "Saving…" : "Save Agent"}
          </Button>
        </DialogFooter>
      </form>

      <section className="border-t pt-5">
        <div className="mb-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Brain className="size-4" /> Experiences
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Meaningful learnings this Agent acquires over time.
          </p>
        </div>
        <div className="space-y-2">
          {agent.experiences.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No experiences yet.
            </div>
          ) : (
            agent.experiences.map((experience) => (
              <ExperienceRow key={experience.id} agentId={agent.id} experience={experience} />
            ))
          )}
        </div>
      </section>

      {confirmingDelete && (
        <DestructiveConfirmationDialog
          title={`Delete ${agent.name}?`}
          description="This deletes the Agent and its experiences, removes it from every host, and deletes its private Sessions. Shared Channel messages and reactions remain attributed to Deleted agent."
          confirmLabel="Delete Agent"
          mutation={agentMutations.delete(agent.id)}
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

function ExperienceRow({ agentId, experience }: { agentId: string; experience: AgentExperience }) {
  const [content, setContent] = useState(experience.content);
  const manage = useMutation(agentMutations.manageExperience());
  const changed = content.trim() !== experience.content;

  return (
    <div className="rounded-lg border bg-muted/15 p-3">
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        className="min-h-16 resize-y border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex justify-end gap-1">
        {changed && (
          <Button
            size="xs"
            disabled={!content.trim() || manage.isPending}
            onClick={() =>
              manage.mutate({
                agentId,
                change: {
                  action: "update",
                  experienceId: experience.id,
                  content: content.trim(),
                },
              })
            }
          >
            Save edit
          </Button>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          title="Delete experience"
          aria-label="Delete experience"
          onClick={() =>
            manage.mutate({
              agentId,
              change: { action: "delete", experienceId: experience.id },
            })
          }
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
