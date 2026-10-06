/**
 * 哪些技能进系统提示：产品自己的按产品开关，第三方一律默认禁用。
 *
 * 「第三方」不靠枚举目录判定，而是按路径分类：落在产品根目录之外的，全部算第三方
 * （`<agentDir>/skills`、`~/.agents/skills`、项目 `.pi/skills` 与祖先 `.agents/skills`、
 * 包资源）。pi 将来多发现什么，都自动归入默认关。
 *
 * 本模块是纯函数，不碰 Electron、不读盘；读盘由调用方以 `loadSkillFromDir` 注入。
 */
import * as path from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";

export interface ExternalSkillRecord {
  name: string;
  description: string;
  filePath: string;
}

export interface SkillPromptPolicy {
  /** 产品自己交给 pi 的技能根目录（出货内置目录、`~/.deskwand/skills`、密库）。 */
  productRoots: readonly string[];
  isProductSkillEnabled(name: string): boolean;
  /** 第三方技能是否被用户在技能页打开过（无 DB 行 ⇒ false）。 */
  isExternalSkillEnabled(name: string): boolean;
  /** 已启用的第三方技能名，升序（参与会话签名）。 */
  enabledExternalSkillNames(): string[];
  /** 已启用的产品技能目录（与 `getSkillPaths()` 同源），用于把被同名第三方赢掉碰撞的产品技能读回。 */
  enabledProductSkillDirs(): readonly string[];
  /** 把本轮发现到的第三方技能全集交给技能页。 */
  recordExternalSkills(records: readonly ExternalSkillRecord[]): void;
}

export function isProductSkillPath(
  filePath: string,
  productRoots: readonly string[],
): boolean {
  const normalized = path.resolve(filePath);
  return productRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return (
      normalized === resolvedRoot ||
      normalized.startsWith(resolvedRoot + path.sep)
    );
  });
}

export interface SelectSkillsOptions {
  base: readonly Skill[];
  policy: Pick<
    SkillPromptPolicy,
    | "productRoots"
    | "isProductSkillEnabled"
    | "isExternalSkillEnabled"
    | "enabledProductSkillDirs"
  >;
  /** 从目录读回一个技能（宿主注入 `loadSkillsFromDir`）。 */
  loadSkillFromDir?: (dir: string) => Skill | undefined;
}

export interface SelectSkillsResult {
  kept: Skill[];
  externals: ExternalSkillRecord[];
  /** 用户打开了、但被同名产品技能挡住的外部技能名。 */
  shadowed: string[];
}

export function selectSkillsForPrompt(
  options: SelectSkillsOptions,
): SelectSkillsResult {
  const { base, policy, loadSkillFromDir } = options;

  const product: Skill[] = [];
  const externals: ExternalSkillRecord[] = [];
  const shadowed: string[] = [];
  const keptNames = new Set<string>();
  const externalNames = new Set<string>();

  // ① 产品技能：按产品开关。
  for (const skill of base) {
    if (!isProductSkillPath(skill.filePath, policy.productRoots)) continue;
    if (policy.isProductSkillEnabled(skill.name)) {
      product.push(skill);
      keptNames.add(skill.name);
    }
  }

  // ② 第三方技能：按 DB 行；同名时让位给产品（并记录被遮蔽的那一个）。
  for (const skill of base) {
    if (isProductSkillPath(skill.filePath, policy.productRoots)) continue;
    if (!externalNames.has(skill.name)) {
      externalNames.add(skill.name);
      externals.push({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
      });
    }
    if (!policy.isExternalSkillEnabled(skill.name)) continue;
    if (keptNames.has(skill.name)) {
      if (!shadowed.includes(skill.name)) shadowed.push(skill.name);
      continue;
    }
    product.push(skill);
    keptNames.add(skill.name);
  }

  // ③ 修复 + 产品优先：产品已启用、但它的副本在碰撞里输给了第三方
  //    （pi 先按名去重、外部副本排在前，所以 base 里只剩第三方那份）⇒ 从自己的
  //    目录读回，并**顶掉同名的第三方副本**。已经保留的产品目录直接跳过，不白读盘。
  const keptDirs = new Set(
    product.map((s) => path.resolve(path.dirname(s.filePath))),
  );
  for (const dir of policy.enabledProductSkillDirs()) {
    if (!loadSkillFromDir) continue;
    if (keptDirs.has(path.resolve(dir))) continue;
    const skill = loadSkillFromDir(dir);
    if (!skill) continue;

    const loserIndex = product.findIndex(
      (s) =>
        s.name === skill.name &&
        !isProductSkillPath(s.filePath, policy.productRoots),
    );
    if (loserIndex >= 0) {
      product.splice(loserIndex, 1);
      if (!shadowed.includes(skill.name)) shadowed.push(skill.name);
    }
    if (product.some((s) => s.name === skill.name)) continue;

    product.push(skill);
    keptNames.add(skill.name);
    keptDirs.add(path.resolve(path.dirname(skill.filePath)));
  }

  return { kept: product, externals, shadowed };
}

/**
 * 会话签名：技能路径 + 已启用的第三方技能名。
 * 不含第三方集合时，技能页的开关切换不会触发 pi 会话重建。
 */
export function buildSkillsSignature(
  skillPaths: readonly string[],
  externalSkillNames: readonly string[],
): string {
  return JSON.stringify({
    paths: [...skillPaths].sort(),
    external: [...externalSkillNames].sort(),
  });
}
