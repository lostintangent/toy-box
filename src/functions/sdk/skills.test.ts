import { describe, expect, test } from "bun:test";
import type { SkillSource } from "@github/copilot-sdk";
import { toSessionSkills } from "./skills";

function sdkSkill(
  name: string,
  source: SkillSource,
  overrides: Partial<{ userInvocable: boolean; enabled: boolean }> = {},
) {
  return {
    name,
    description: `${name} description`,
    source,
    userInvocable: true,
    enabled: true,
    ...overrides,
  };
}

describe("skill projection", () => {
  test("collapses SDK sources into project and global scopes", () => {
    expect(
      toSessionSkills([
        sdkSkill("personal", "personal-agents"),
        sdkSkill("local", "project"),
        sdkSkill("bundled", "builtin"),
        sdkSkill("parent", "inherited"),
      ]),
    ).toEqual([
      { name: "local", description: "local description", type: "project" },
      { name: "parent", description: "parent description", type: "project" },
      { name: "personal", description: "personal description", type: "global" },
      { name: "bundled", description: "bundled description", type: "global" },
    ]);
  });

  test("omits disabled and non-invocable skills", () => {
    expect(
      toSessionSkills([
        sdkSkill("visible", "project"),
        sdkSkill("disabled", "project", { enabled: false }),
        sdkSkill("internal", "builtin", { userInvocable: false }),
      ]),
    ).toEqual([{ name: "visible", description: "visible description", type: "project" }]);
  });
});
