/**
 * 欢迎页（= 空会话）用的仓库事实与起手动作。
 *
 * 为什么单独成文件：这两个函数都是纯函数，测试不需要渲染 React；WelcomeView 只负责
 * 把它们画出来。与 welcome-quick-entries.ts 同一套思路（数据与展示分离）。
 *
 * 起手动作按仓库状态给，不是固定三条：干净仓库说「跑测试」和「解释上个提交」，
 * 有改动才说「看这 N 处改动」。给不存在的改动推荐「看改动」是空按钮。
 */
import type { TFunction } from "i18next";
import type { RepoSummary } from "../shared/repo-summary";

export type WelcomeRepoSuggestionId =
  | "run-tests"
  | "review-changes"
  | "explain-last-commit";

export interface WelcomeRepoSuggestion {
  id: WelcomeRepoSuggestionId;
  /** 填进输入框的示例文案 key（不自动发送） */
  promptKey: string;
}

/** `main · 3 个改动`；无分支时保留改动数，非仓库 / 空快照返回空串。 */
export function formatRepoFacts(
  repo: RepoSummary | null,
  t: TFunction,
): string {
  if (!repo || !repo.isRepo) return "";
  const parts: string[] = repo.branch
    ? [t("welcome.repo.branch", { branch: repo.branch })]
    : [];
  const dirty = repo.changedFiles;
  if (dirty > 0) parts.push(t("welcome.repo.dirty", { count: dirty }));
  return parts.join(" · ");
}

export function welcomeRepoSuggestions(
  repo: RepoSummary | null,
): WelcomeRepoSuggestion[] {
  if (!repo || !repo.isRepo) return [];
  const dirty = repo.changedFiles;
  if (dirty > 0) {
    return [
      { id: "review-changes", promptKey: "welcome.repo.prompt.reviewChanges" },
      { id: "run-tests", promptKey: "welcome.repo.prompt.runTests" },
    ];
  }
  return [
    { id: "run-tests", promptKey: "welcome.repo.prompt.runTests" },
    // branch=null 也可能是空仓库；现有 RepoSummary 没有 hasCommit，保守不推“上个提交”。
    ...(repo.branch
      ? [
          {
            id: "explain-last-commit" as const,
            promptKey: "welcome.repo.prompt.explainLast",
          },
        ]
      : []),
  ];
}
