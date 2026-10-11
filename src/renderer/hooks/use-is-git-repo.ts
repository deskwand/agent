/**
 * @module renderer/hooks/use-is-git-repo
 *
 * 「这个工作目录是不是 git 仓库」的唯一探针：顶栏的代码审查入口与消息里的产物卡片
 * 都从它取结论 —— 两处各探一次会白 spawn 一个 `git status`，所以探针与缓存都收在这里。
 *
 * 返回值语义（三点）：
 *   · `true` / `false` —— 探到了（`true` = 是仓库）
 *   · `null`           —— 没有 cwd 可探，或这个 cwd 的结论还没回来
 *
 * 缓存 10s，正负都缓存：切会话不该反复 spawn，而用户中途 `git init` 之后，
 * 窗口重新获得焦点时会再问一次（见 hook 里那段 focus 监听）。
 *
 * 唯一的例外是「没有 git 桥」那一支：它不 spawn，因此也不写缓存。
 */
import { useEffect, useState } from "react";

const PROBE_TTL_MS = 10_000;

interface ProbeResult {
  isRepo: boolean;
  at: number;
}

/** 已兑现的结论（含时刻，供 TTL 判定）。 */
const settled = new Map<string, ProbeResult>();
/** 在飞的探针：同 cwd 的并发调用共享同一个 Promise（只 spawn 一次）。 */
const inFlight = new Map<string, Promise<boolean>>();

async function probe(cwd: string, force = false): Promise<boolean> {
  if (!force) {
    const cached = settled.get(cwd);
    if (cached && Date.now() - cached.at < PROBE_TTL_MS) {
      return cached.isRepo;
    }
  }
  const pending = inFlight.get(cwd);
  if (pending) {
    return pending;
  }
  const run = (async () => {
    try {
      const api = window.electronAPI?.git;
      if (!api?.hasChanges) {
        // 浏览器模式 / 没有 git 桥：库里根本没有可审查的东西
        return false;
      }
      const result = await api.hasChanges(cwd);
      const isRepo = Boolean(result?.isRepo);
      settled.set(cwd, { isRepo, at: Date.now() });
      return isRepo;
    } catch {
      // 探不通（git 缺失、超时）按「不是仓库」处理：审查面板对非仓库本来就是空列表，
      // 而报错提示在这里没有合适的落点
      settled.set(cwd, { isRepo: false, at: Date.now() });
      return false;
    } finally {
      inFlight.delete(cwd);
    }
  })();
  inFlight.set(cwd, run);
  return run;
}

export function useIsGitRepo(cwd?: string | null): boolean | null {
  const [known, setKnown] = useState<{ cwd: string; isRepo: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    void probe(cwd).then((isRepo) => {
      if (alive) setKnown({ cwd, isRepo });
    });
    return () => {
      alive = false;
    };
  }, [cwd]);

  // 用户可能在会话中途去终端里 `git init`，做完就切回应用 —— 窗口重新获得焦点时再问一次，
  // 否则挂在同一个 cwd 上的 hook 永远不会重探（effect 只依赖 cwd）。
  // 上一次结论是「不是仓库」时强制绕过 TTL（捞的正是这个时刻）；已经是仓库时走 TTL，
  // 于是焦点切换通常不会真的 spawn，只顺手让「仓库被删」也能在 10s 后被发现。
  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    const onFocus = () => {
      const force = settled.get(cwd)?.isRepo === false;
      void probe(cwd, force).then((isRepo) => {
        if (alive) setKnown({ cwd, isRepo });
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [cwd]);

  if (!cwd) return null;
  // 只认「和当前 cwd 同一条」的结论：换目录后不能把上一个目录的判断留在屏幕上
  if (known && known.cwd === cwd) return known.isRepo;
  // 首帧就命中缓存：effect 要等 paint 之后才跑，没有这一手的话每次切回已探过的
  // 会话都会先拿 null 渲染一帧（按钮闪一下）。
  return peekIsGitRepo(cwd);
}

/** 同步读缓存（TTL 内命中）：给 `useIsGitRepo` 的首帧用，也可单独用于不需要订阅的场合。 */
export function peekIsGitRepo(cwd?: string | null): boolean | null {
  if (!cwd) return null;
  const hit = settled.get(cwd);
  return hit && Date.now() - hit.at < PROBE_TTL_MS ? hit.isRepo : null;
}

/** 测试用：清掉模块级缓存，避免用例之间互相污染。 */
export function resetIsGitRepoCacheForTests(): void {
  settled.clear();
  inFlight.clear();
}
