/**
 * 附件落盘的路径与文件名。
 *
 * 附件文件名来自邮件的 `Content-Disposition` —— **攻击者可控**。这是本模块唯一存在的理由：
 * 一封邮件可以声明自己叫 `../../../../.ssh/authorized_keys`，而我们会照着写。
 * 所以：先只取最后一段、再去掉宿主文件系统不接受的字符、最后断言结果仍在根目录内。
 *
 * 纯函数、不碰文件系统，因为调用方（MCP 子进程）自己负责 mkdir 与写入。
 */
import * as path from "node:path";

const MAX_NAME_LENGTH = 120;
/** 扩展名也要有上限，否则 `"a." + "b".repeat(5000)` 会绕过整个长度限制（见下）。 */
const MAX_EXTENSION_LENGTH = 20;
/** 子目录最多几层 —— 恶意/异常的 `directory` 参数不该造出深不见底的路径。 */
const MAX_SUBDIR_DEPTH = 4;
const FALLBACK_NAME = "unnamed";
/** Windows 保留设备名。带扩展名也保留（`CON.txt` 一样打不开）。 */
const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * 按 UTF-8 **字节**截断。
 *
 * 文件系统的 `NAME_MAX` 是字节数（常见 255），**不是字符数** —— 按字符截断挡不住
 * CJK/emoji：116 个 emoji 是 464 字节，照样 ENAMETOOLONG。
 * 顺带避开了把代理对切成两半的问题：这里按码点循环，不会切出孤立代理字符。
 *
 * 因为每个码点至少 1 字节，字节上限同时保证 `value.length`（UTF-16）不超过同一个上限。
 */
function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let out = "";
  let used = 0;
  for (const point of value) {
    const size = Buffer.byteLength(point, "utf8");
    if (used + size > maxBytes) break;
    out += point;
    used += size;
  }
  return out;
}

/** 文件名净化。**永不抛异常** —— 恶意文件名不该让整封邮件读不出来。 */
export function sanitizeAttachmentName(raw: string | undefined): string {
  if (typeof raw !== "string") return FALLBACK_NAME;

  // 1) 只取最后一段。POSIX 与 Windows 两种分隔符都要切 —— 发件人在别的平台上。
  //    先归一再切，避免 `a\/b` 这种混用漏过。
  const lastSegment = raw.replace(/\\/g, "/").split("/").pop() ?? "";

  // 2) 去掉控制字符（含 NUL）与宿主不接受的字符
  // eslint-disable-next-line no-control-regex -- 控制字符类就是本行的目的，不是笔误
  const control = lastSegment.replace(/[\u0000-\u001f\u007f]/g, "");
  const illegal = control.replace(/[<>:"|?*]/g, "");

  // 3) 去掉首部点号（不能让附件变成隐藏文件）与尾部点号/空格
  //    （Windows 会静默丢掉尾部的点与空格，留着会跟去重逻辑对不上）
  const trimmed = illegal.replace(/^\.+/, "").replace(/[. ]+$/, "");

  // 4) 长度上限。**在扩展名前截断**，否则 `报告.pdf` 会变成 `报告.pd`。
  //    扩展名单独限长：不然 `"a." + "b".repeat(5000)` 会让预算变成负数，
  //    只有词干被截，整个名字仍然是 5000+ 字符 —— 落到盘上就是 ENAMETOOLONG。
  const rawExt = path.extname(trimmed);
  const ext =
    Buffer.byteLength(rawExt, "utf8") > MAX_EXTENSION_LENGTH
      ? truncateToBytes(rawExt, MAX_EXTENSION_LENGTH)
      : rawExt;
  const stem = ext ? trimmed.slice(0, -ext.length) : trimmed;
  const budget = MAX_NAME_LENGTH - Buffer.byteLength(ext, "utf8");
  const capped = truncateToBytes(stem, Math.max(1, budget));
  const limited = `${capped}${ext}`;

  // 5) 兜底：空了、或撞上 Windows 保留名。
  //    Windows 的设备名判定只看**第一个点号之前**那一段，所以 `nul.tar.gz` 同样是设备名；
  //    而且段内可以有空格（`CON .txt`）。两种形态都要查。
  const stemLower = (ext ? limited.slice(0, -ext.length) : limited).toLowerCase();
  const firstSegment = limited.split(".")[0].trim().toLowerCase();
  if (
    !limited ||
    WINDOWS_RESERVED.has(stemLower) ||
    WINDOWS_RESERVED.has(firstSegment)
  ) {
    // 保留名加前缀而不是整个丢弃 —— 用户至少还能看出原来叫什么
    return limited ? `_${limited}` : FALLBACK_NAME;
  }
  return limited;
}

/**
 * 与同目录内已有文件去重。序号加在**扩展名之前**（`a.tar.gz` → `a.tar (2).gz`），
 * 因为 `a (2).tar.gz` 看起来像另一个包。
 *
 * 加序号会把名字撑长，所以词干要**先让出序号的位置**，否则第一次碰撞就突破长度上限。
 */
export function resolveAttachmentName(raw: string, taken: Set<string>): string {
  const base = sanitizeAttachmentName(raw);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const extBytes = Buffer.byteLength(ext, "utf8");
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const room = MAX_NAME_LENGTH - extBytes - suffix.length;
    const head = room > 0 ? truncateToBytes(stem, room) : "";
    const candidate = `${head}${suffix}${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * 子目录单段的净化。
 *
 * 与文件名**故意不同**：不去首部点号。那条规则只防「附件变成隐藏文件」，对目录段没有意义，
 * 而静默把 `..foo` 改写成 `foo` 会让用户以为写到了别的目录。
 * 这里只去除分隔符、控制字符与宿主不接受的字符。
 */
function sanitizePathSegment(segment: string): string {
  // eslint-disable-next-line no-control-regex -- 控制字符类就是本行的目的，不是笔误
  const withoutControl = segment.replace(/[\u0000-\u001f\u007f]/g, "");
  return withoutControl
    .replace(/[<>:"|?*\\/]/g, "")
    .replace(/[. ]+$/, "")
    .trim();
}

export interface AttachmentPathInput {
  /** 附件根目录（由主进程通过 env 注入） */
  root: string;
  /** 账号邮箱地址 —— 用作一级子目录 */
  email: string;
  /** 邮件声明的文件名。**不可信** */
  filename: string;
  /** 可选相对子目录。绝对路径与 `..` 会被拒绝 */
  subdir?: string;
  /** 本次调用内已占用的文件名 */
  taken: Set<string>;
}

export function resolveAttachmentPath(input: AttachmentPathInput): string {
  const { root, email, filename, subdir, taken } = input;

  // 账号目录名同样净化：邮箱地址本身也来自用户输入，`../evil@x.com` 会跑出根目录
  const accountDir = sanitizeAttachmentName(email);

  let targetDir = path.join(root, accountDir);
  if (subdir !== undefined && subdir !== "") {
    if (path.isAbsolute(subdir)) {
      throw new Error(`subdir must be relative: ${subdir}`);
    }

    // **先查 `..` 段，再净化。** 顺序反过来会让 `..` 在净化时被吃掉、
    // 静默变成一个完全不同的子目录 —— 用户以为写到了 a/，实际落在别处。
    //
    // 只 `trim()` 空格，**不能去掉尾部的点**：`/[\. ]+$/` 会把整个 `..` 匹配掉、
    // 归一化成空串，于是一个真的 `..` 反而被当成「空段」静默丢弃、不再报错。
    // Windows 把尾部的点与空格都当垃圾，所以 `".. "` 确实是 `..`。
    const rawSegments = subdir.replace(/\\/g, "/").split("/");
    if (rawSegments.some((segment) => segment.trim() === "..")) {
      throw new Error(`subdir escapes the attachment root: ${subdir}`);
    }
    const safeSegments = rawSegments
      .filter((segment) => segment !== "" && segment !== ".")
      .map((segment) => sanitizePathSegment(segment))
      // 净化之后再守一道：任何能变成 `..` 的段也一律丢掉
      .filter(
        (segment) => segment !== "" && segment !== "." && segment !== "..",
      )
      .slice(0, MAX_SUBDIR_DEPTH);

    const candidate = path.resolve(targetDir, ...safeSegments);
    const relative = path.relative(targetDir, candidate);
    // `..foo` 是**合法**的目录名，别用 startsWith("..") ——那会把它误拒。
    // 逃逸只可能是「恰好是 ..」或「以 ../ 开头」两种形态。
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`subdir escapes the attachment root: ${subdir}`);
    }
    targetDir = candidate;
  }

  const name = resolveAttachmentName(filename, taken);
  const resolved = path.resolve(targetDir, name);

  // 最后一道断言：无论上面哪一步错了，结果必须落在根目录内
  const rootWithSep = path.resolve(root) + path.sep;
  if (!resolved.startsWith(rootWithSep)) {
    throw new Error(`resolved attachment path escapes the root: ${resolved}`);
  }
  return resolved;
}
