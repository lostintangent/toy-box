import { useMemo } from "react";
import type { SessionSkill } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";

export interface SkillPickerProps {
  /** Current textarea value — used to detect `/` prefix and filter skills */
  input: string;
  /** Available skills (from React Query cache or stream event) */
  skills: SessionSkill[] | undefined;
  /** Called when a skill is selected */
  onSelect: (skill: SessionSkill) => void;
  /** Anchor element (the InputGroup) */
  children: React.ReactNode;
}

/** Returns the text after `/` while the user is still typing a skill name, or undefined. */
function getSlashQuery(input: string): string | undefined {
  if (!input.startsWith("/")) return undefined;
  const afterSlash = input.slice(1);
  if (afterSlash.includes(" ")) return undefined;
  return afterSlash;
}

export function SkillPicker({ input, skills, onSelect, children }: SkillPickerProps) {
  const slashQuery = getSlashQuery(input);

  const filtered = useMemo(() => {
    if (slashQuery === undefined || !skills?.length) return [];
    if (slashQuery === "") return skills;
    const q = slashQuery.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [skills, slashQuery]);

  return (
    <Popover open={filtered.length > 0}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {filtered.length > 0 && (
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
                {filtered.map((skill) => (
                  <CommandItem
                    key={skill.name}
                    value={skill.name}
                    onMouseDown={(e) => e.preventDefault()}
                    onSelect={() => onSelect(skill)}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm">/{skill.name}</div>
                      {skill.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {skill.description}
                        </div>
                      )}
                    </div>
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
