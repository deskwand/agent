/**
 * 把 `selectSkillsForPrompt()` 适配成 SDK 的 `skillsOverride`。
 *
 * SDK 在**同名碰撞解析之后**才调用它（`resource-loader.js` 的
 * `updateSkillsFromPaths()`），所以这里既要过滤，也要负责"把被第三方赢掉碰撞的
 * 产品技能读回来"——否则产品那份会整条消失。
 */
import {
  loadSkillsFromDir,
  type ResourceDiagnostic,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { log } from "../utils/logger";
import {
  selectSkillsForPrompt,
  type SkillPromptPolicy,
} from "./external-skill-policy";

export interface SkillsOverrideBase {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

export function createSkillsOverride(
  getPolicy: () => SkillPromptPolicy | undefined,
) {
  return (base: SkillsOverrideBase): SkillsOverrideBase => {
    // 策略是**调用时**取的：`PiExtensionHost` 按 cwd 缓存，谁先建谁来定构造参数，
    // 把策略绑在构造时会让「插件页先建 host」那条路把过滤整个吞掉。
    const policy = getPolicy();
    if (!policy) return base;

    const { kept, externals, shadowed } = selectSkillsForPrompt({
      base: base.skills,
      policy,
      loadSkillFromDir: (dir) => {
        const result = loadSkillsFromDir({ dir, source: "product" });
        for (const diagnostic of result.diagnostics) {
          if (diagnostic.type !== "collision") {
            log(`[Skills] ${diagnostic.path ?? ""} ${diagnostic.message}`);
          }
        }
        return result.skills[0];
      },
    });

    policy.recordExternalSkills(externals);
    if (shadowed.length > 0) {
      log(
        `[Skills] third-party copies shadowed by product skills: ${shadowed.join(", ")}`,
      );
    }
    return { skills: kept, diagnostics: base.diagnostics };
  };
}
