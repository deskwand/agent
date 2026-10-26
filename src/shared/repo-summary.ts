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

/** `git diff HEAD --numstat` 的输出 → 增删总数。二进制文件（`-`）按 0 计。 */
export function parseNumstatTotals(stdout: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!match) continue;
    additions += match[1] === "-" ? 0 : Number(match[1]);
    deletions += match[2] === "-" ? 0 : Number(match[2]);
  }
  return { additions, deletions };
}

/** 只有「本来就不是仓库」才算空快照；超时、git 缺失等失败必须让调用方看到错误。 */
export function isNotAGitRepositoryError(stderr: string | undefined): boolean {
  return /not a git repository/i.test(stderr ?? "");
}
