/**
 * 会话概览「环境 / 更改」的 git 事实。
 * main 组装、preload 透传、renderer 渲染 —— 三处共用同一份类型定义。
 */
export interface RepoSummary {
  isRepo: boolean;
  branch: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  untracked: number;
}

export const EMPTY_REPO_SUMMARY: RepoSummary = {
  isRepo: false,
  branch: null,
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  untracked: 0,
};

/** `git rev-parse --abbrev-ref HEAD` 的输出 → 分支名；空输出（空仓库 / 失败）→ null。 */
export function parseBranchName(stdout: string): string | null {
  const name = stdout.trim();
  return name.length > 0 ? name : null;
}
