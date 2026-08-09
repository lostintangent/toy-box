import type { SessionSkill } from "../../model";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/shared/components/ui/command";
import { MetadataBadge } from "@/shared/components/ui/metadata-badge";

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
      <PopoverAnchor asChild>
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px" />
      </PopoverAnchor>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        side="top"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              {filteredSkills.map((skill) => (
                <CommandItem
                  key={skill.name}
                  value={skill.name}
                  onMouseDown={(e) => e.preventDefault()}
                  onSelect={() => onSelect(skill)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm">/{skill.name}</div>
                    {skill.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {skill.description}
                      </div>
                    )}
                  </div>
                  {showGlobalSkillBadges && skill.type === "global" && (
                    <MetadataBadge>Global</MetadataBadge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
