import type { CopilotClient } from "@github/copilot-sdk";
import type { SessionSkill } from "@sessions/model";

type SdkSkill = Awaited<ReturnType<CopilotClient["rpc"]["skills"]["discover"]>>["skills"][number];

/** Normalize enabled, user-invocable SDK skills into Toy Box's two scope types. */
export function toSessionSkills(skills: readonly SdkSkill[]): SessionSkill[] {
  return skills
    .filter((skill) => skill.userInvocable && skill.enabled)
    .map<SessionSkill>((skill) => ({
      name: skill.name,
      description: skill.description,
      type: skill.source === "project" || skill.source === "inherited" ? "project" : "global",
      ...(skill.path ? { path: skill.path } : {}),
    }))
    .sort((left, right) => {
      if (left.type === right.type) return 0;
      return left.type === "project" ? -1 : 1;
    });
}
