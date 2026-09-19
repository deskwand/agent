/** 扁平筛选结果的展示上限。命中数超过它时，UI 必须明示，不得静默截断。 */
export const FILTER_RESULT_CAP = 200;

export interface WorkspaceFilterResult {
  /** 截断后的展示用结果 */
  matches: Array<{ relPath: string; size: number }>;
  /** 截断前的命中总数，UI 用它判断要不要提示「只显示前 N 条」 */
  total: number;
}

/** 大小写不敏感的子串匹配；空查询返回空结果（由调用方决定回树）。 */
export function filterWorkspaceFiles(
  files: Array<{ relPath: string; size: number }>,
  query: string,
  cap: number = FILTER_RESULT_CAP,
): WorkspaceFilterResult {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: [], total: 0 };
  const hits = files.filter((file) =>
    file.relPath.toLowerCase().includes(needle),
  );
  return { matches: hits.slice(0, cap), total: hits.length };
}
