import type { SessionSkill } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { MetadataBadge } from "@/components/ui/metadata-badge";

function getSlashQuery(input: string): string | undefined {
  if (!input.startsWith("/")) return undefined;
  const afterSlash = input.slice(1);
  if (afterSlash.includes(" ")) return undefined;
  return afterSlash;
}

export function SkillPicker({
  input,
  skills,
  showGlobalSkillBadges,
  onSelect,
  children,
}: {
  input: string;
  skills: SessionSkill[] | undefined;
  showGlobalSkillBadges: boolean;
  onSelect: (skill: SessionSkill) => void;
  children: React.ReactNode;
}) {
  const slashQuery = getSlashQuery(input);

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

  return (
    <Popover open={filteredSkills.length > 0}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {filteredSkills.length > 0 && (
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
      )}
    </Popover>
  );
}
