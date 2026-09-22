import type { ElementSelection } from "../../shared/ipc-types";
import type { ChatInputAttachedFile } from "../components/ChatInput";
import { stripLeadingSkillToken } from "./reference-tokens";

export const DRAFT_SCHEMA_VERSION = 1;
/** 每个槽位一个 key：整表 JSON 会把每次保存变成 O(全部草稿) 的同步写。 */
export const DRAFT_KEY_PREFIX = "deskwand.draft.";
/** 无会话（欢迎页）草稿的槽位名。 */
export const NEW_SESSION_DRAFT_KEY = "__new__";
/** 单草稿落盘图片的 base64 字符合计上限；超出从末尾截断（保留先贴的）。 */
export const MAX_DRAFT_IMAGE_CHARS = 10_000_000;

export interface ChatDraftImage {
  base64: string;
  mediaType: string;
}

/**
 * 一份输入框草稿。
 *
 * 图片刻意不存 `url`：那个字段是 `URL.createObjectURL()` 的产物，per-document，
 * 重启或重挂载即失效。恢复时由 `base64` 拼 data URL（见 ChatInput 的 applyDraft）。
 */
export interface ChatDraft {
  v: number;
  text: string;
  images: ChatDraftImage[];
  files: ChatInputAttachedFile[];
  elSelections: ElementSelection[];
}

export const EMPTY_DRAFT: ChatDraft = {
  v: DRAFT_SCHEMA_VERSION,
  text: "",
  images: [],
  files: [],
  elSelections: [],
};

export function draftStorageKey(draftKey: string): string {
  return `${DRAFT_KEY_PREFIX}${draftKey}`;
}

/**
 * 与 `ChatInput` 的 `hasInputContent` 同一套「空白不算内容」定义 —— 两边都走
 * `stripLeadingSkillToken`，所以「只有 /skill:pdf、没有正文」在提交门禁与草稿判定里
 * 是同一个答案。两处给不出一致的答案，就会出现「输入框看着空的、草稿却能复活」。
 */
export function isDraftEmpty(draft: ChatDraft): boolean {
  return (
    stripLeadingSkillToken(draft.text).trim() === "" &&
    draft.images.length === 0 &&
    draft.files.length === 0 &&
    draft.elSelections.length === 0
  );
}

/** 按预算截断图片，保留先贴的。典型压缩截图 20 万 ~ 80 万字符。 */
export function capDraftImages(
  images: readonly ChatDraftImage[],
  budget: number = MAX_DRAFT_IMAGE_CHARS,
): ChatDraftImage[] {
  const kept: ChatDraftImage[] = [];
  let used = 0;
  for (const image of images) {
    if (used + image.base64.length > budget) break;
    used += image.base64.length;
    kept.push(image);
  }
  return kept;
}

function isRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/** 图片多一层字段校验：它的 base64 长度参与预算计算（走进 `capDraftImages`）。 */
function isChatDraftImage(value: unknown): value is ChatDraftImage {
  if (!isRecord(value)) return false;
  const image = value as Partial<ChatDraftImage>;
  return (
    typeof image.base64 === "string" && typeof image.mediaType === "string"
  );
}

/**
 * 读 localStorage 是信任边界，就在便宜的这一侧校验。
 *
 * 三个数组都要求元素是对象：`null` 这类非对象元素会在渲染路径上抛
 * （`file.type.startsWith` / `selection.selector`），被 PanelErrorBoundary 兜成整块
 * fallback —— 一份坏草稿不该把整个聊天面板打掉。图片额外要求两个字符串字段，
 * 因为它的 base64 长度要参与预算计算。
 * 刻意**不做**更深的结构校验：那会把我们自己写入的数据当成敌意输入去解析，
 * 而这份数据的唯一生产者就是本模块。
 */
function isChatDraft(value: unknown): value is ChatDraft {
  if (!isRecord(value)) return false;
  const draft = value as Partial<ChatDraft>;
  return (
    draft.v === DRAFT_SCHEMA_VERSION &&
    typeof draft.text === "string" &&
    Array.isArray(draft.images) &&
    draft.images.every(isChatDraftImage) &&
    Array.isArray(draft.files) &&
    draft.files.every(isRecord) &&
    Array.isArray(draft.elSelections) &&
    draft.elSelections.every(isRecord)
  );
}

function tryWrite(draftKey: string, draft: ChatDraft): boolean {
  const storage = getStorage();
  if (storage === null) return false;
  try {
    storage.setItem(draftStorageKey(draftKey), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/**
 * 存储不可用时一律静默 no-op。
 *
 * 这不是防御性代码：`src/tests/store/session-state.test.ts` 跑在 **node** 环境
 * （文件顶部没有 `// @vitest-environment jsdom`）且会调用 `removeSession`，
 * 而 store 的那个 action 会调 `pruneDrafts` —— 少了这层判断它就直接 ReferenceError。
 * 草稿本来就是"尽力而为"的数据，存储不在时没有第二种正确行为。
 */
function getStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** 读草稿；缺失、损坏或版本不符一律当空，并顺手清掉脏数据。 */
export function readDraft(draftKey: string): ChatDraft | null {
  const storage = getStorage();
  if (storage === null) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(draftStorageKey(draftKey));
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeDraft(draftKey);
    return null;
  }
  if (!isChatDraft(parsed)) {
    removeDraft(draftKey);
    return null;
  }
  return parsed;
}

export function removeDraft(draftKey: string): void {
  const storage = getStorage();
  if (storage === null) return;
  try {
    storage.removeItem(draftStorageKey(draftKey));
  } catch {
    /* 存储不可用时无事可做：草稿是尽力而为的数据 */
  }
}

/**
 * 写草稿。
 *
 * 空草稿一律**删除 key**，不能改成「内容为空就跳过写入」—— 否则用户清空后切走，
 * 下次打开旧草稿会复活（VS Code 踩过这个坑）。
 *
 * 配额不足时按 丢图片 → 丢附件 inlineDataBase64 → 放弃 的顺序降级重试。全程静默。
 */
export function writeDraft(draftKey: string, draft: ChatDraft): boolean {
  if (isDraftEmpty(draft)) {
    removeDraft(draftKey);
    return true;
  }

  const normalized: ChatDraft = {
    ...draft,
    v: DRAFT_SCHEMA_VERSION,
    images: capDraftImages(draft.images),
  };
  if (tryWrite(draftKey, normalized)) return true;

  const withoutImages: ChatDraft = { ...normalized, images: [] };
  if (tryWrite(draftKey, withoutImages)) return true;

  // inlineDataBase64 置 undefined：JSON.stringify 会整个丢掉这个字段。
  const withoutInline: ChatDraft = {
    ...withoutImages,
    files: withoutImages.files.map((file) => ({
      ...file,
      inlineDataBase64: undefined,
    })),
  };
  return tryWrite(draftKey, withoutInline);
}

function listDraftStorageKeys(): string[] {
  const storage = getStorage();
  if (storage === null) return [];
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

/** 清掉不在 validKeys 里的草稿；`__new__` 槽位永远保留。 */
export function pruneDrafts(validKeys: readonly string[]): void {
  const valid = new Set<string>([...validKeys, NEW_SESSION_DRAFT_KEY]);
  for (const storageKey of listDraftStorageKeys()) {
    const draftKey = storageKey.slice(DRAFT_KEY_PREFIX.length);
    if (!valid.has(draftKey)) removeDraft(draftKey);
  }
}
