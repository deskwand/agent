import * as fs from "fs";
import { join, resolve } from "path";

/**
 * 在工作区的若干根目录下按**文件名**广度优先查找。
 *
 * 语义（与原先内联在 `shell.showItemInFolder` 里的实现一致，勿改）：
 * - 多个根**先全部入队**再统一逐层展开 → 顺序是"**层数优先、并列时按根顺序**"。
 *   也就是说根 3 的深度 0 文件会排在根 1 的深度 1 文件之前。
 * - 首个命中即返回（即层数最浅的那个），不做全量扫描
 * - `maxDirs` 是访问目录数的上限，防止在大工作区上无界遍历
 */
export function findFileByName(
  fileName: string,
  roots: string[],
  maxDirs = 2000,
): string | null {
  if (!fileName) {
    return null;
  }

  const visited = new Set<string>();
  const queue = roots
    .map((root) => resolve(root))
    .filter(
      (root) =>
        !!root && fs.existsSync(root) && fs.statSync(root).isDirectory(),
    );

  let scannedDirs = 0;

  while (queue.length > 0 && scannedDirs < maxDirs) {
    const dir = queue.shift()!;
    if (visited.has(dir)) {
      continue;
    }
    visited.add(dir);
    scannedDirs += 1;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }

  return null;
}
