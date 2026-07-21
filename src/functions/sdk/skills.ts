import type { SkillSource } from "@github/copilot-sdk";
import type { SessionSkill } from "@/types";

type SdkSkillMetadata = {
  name: string;
  description: string;
  source: SkillSource;
  userInvocable: boolean;
  enabled: boolean;
};

/** Normalize enabled, user-invocable SDK skills into Toy Box's two scope types. */
export function toSessionSkills(skills: readonly SdkSkillMetadata[]): SessionSkill[] {
  return skills
    .filter((skill) => skill.userInvocable && skill.enabled)
    .map<SessionSkill>((skill) => ({
      name: skill.name,
      description: skill.description,
      type: skill.source === "project" || skill.source === "inherited" ? "project" : "global",
    }))
    .sort((left, right) => {
      if (left.type === right.type) return 0;
      return left.type === "project" ? -1 : 1;
    });
}
