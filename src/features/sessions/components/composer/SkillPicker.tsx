import { useRef } from "react";
import { FilePenLine } from "lucide-react";
import type { SessionSkill } from "../../model";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { Popover, PopoverContent } from "@/shared/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/shared/components/ui/command";
import { MetadataBadge } from "@/shared/components/ui/metadata-badge";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { Button } from "@/shared/components/ui/button";

function getSlashQuery(prompt: string): string | undefined {
  if (!prompt.startsWith("/")) return undefined;
  const afterSlash = prompt.slice(1);
  if (afterSlash.includes(" ")) return undefined;
  return afterSlash;
}

export function SkillPicker({
  prompt,
  skills,
  showGlobalSkillBadges,
  onSelect,
}: {
  prompt: string;
  skills: SessionSkill[] | undefined;
  showGlobalSkillBadges: boolean;
  onSelect: (skill: SessionSkill) => void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const { openFile } = useWorkspaceSurface();
  const slashQuery = getSlashQuery(prompt);

  let filteredSkills: SessionSkill[] = [];
  if (slashQuery === "") {
    filteredSkills = skills ?? [];
  } else if (slashQuery !== undefined && skills?.length) {
    const query = slashQuery.toLowerCase();
    filteredSkills = skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
    );
  }

  if (filteredSkills.length === 0) return null;

  return (
    <Popover open>
      <span ref={anchorRef} className="pointer-events-none absolute inset-x-0 top-0 h-px" />
      <PopoverContent
        anchor={anchorRef}
        className="w-72 p-0"
        align="start"
        side="top"
        sideOffset={8}
        initialFocus={false}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              {filteredSkills.map((skill) => {
                const path = skill.path;
                return (
                  <CommandItem
                    key={skill.name}
                    value={skill.name}
                    onMouseDown={(e) => e.preventDefault()}
                    onSelect={() => onSelect(skill)}
                  >
                    <div className="min-w-0 flex-1">
                      <ScrollableFade className="whitespace-nowrap text-sm font-medium">
                        <span className="shrink-0">/{skill.name}</span>
                      </ScrollableFade>
                      {skill.description && (
                        <ScrollableFade className="whitespace-nowrap text-xs text-muted-foreground">
                          <span className="shrink-0">{skill.description}</span>
                        </ScrollableFade>
                      )}
                    </div>
                    {showGlobalSkillBadges && skill.type === "global" && (
                      <MetadataBadge>Global</MetadataBadge>
                    )}
                    {path && openFile && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Open ${skill.name} skill file`}
                        title="Open SKILL.md"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openFile(path);
                        }}
                      >
                        <FilePenLine aria-hidden="true" />
                      </Button>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
