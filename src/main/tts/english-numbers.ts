/**
 * @module main/tts/english-numbers
 *
 * 把英文字符串里的数字写成英文词。**只在英文路径调用**：中文路径由模型自带的
 * date/number/phone.fst 处理，而英文模型包里没有任何 .fst（实测），数字会整段
 * 消失（`Ignore OOV '12'` → 读出来是 "the tests"）。
 *
 * 规则（设计 §5）：
 * - 纯数字（可带千分位逗号）→ 基数词：12 → "twelve"，1,234 → "one thousand two hundred thirty-four"
 * - 小数点/点分版本 → point + 每段逐位：3.14 → "three point one four"
 * - 百分比 → 基数词 + percent
 * - 紧邻字母、`_`、`#`、`/` 的数字 → 逐位：sha256 → "sha two five six"（基数词会读成"两百五十六"）
 * - 连字符两侧都是数字组 → 各自基数词、连字符保留：10-20 → "ten-twenty"
 * - 全角数字先转半角
 *
 * 不做（已知边界，测试里钉住了现状）：日期、货币、序数词、科学计数法。
 */
const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

/** 0-999 的基数词。 */
function under1000(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rest = n % 10;
    const tens = TENS[Math.floor(n / 10)];
    return rest === 0 ? tens : `${tens}-${ONES[rest]}`;
  }
  const rest = n % 100;
  const head = `${ONES[Math.floor(n / 100)]} hundred`;
  return rest === 0 ? head : `${head} ${under1000(rest)}`;
}

function digitByDigit(run: string): string {
  return run
    .split("")
    .filter((ch) => /\d/.test(ch))
    .map((ch) => ONES[Number(ch)])
    .join(" ");
}

/** 非负整数的基数词（按千分位分组；超过 15 位就退回逐位，不抛错）。 */
function cardinal(digits: string): string {
  const clean = digits.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  const n = Number(clean);
  // 16 位以上没有对应档位（trillion 之后是 quadrillion），而且早已超出安全精度：
  // 直接逐位读 —— 否则 SCALES[...] 会读出字面量 "undefined"。
  if (!Number.isFinite(n) || clean.length > 15 || n > Number.MAX_SAFE_INTEGER)
    return digitByDigit(clean);
  if (n < 1000) return under1000(n);

  const groups: number[] = [];
  let rest = clean;
  while (rest.length > 3) {
    groups.unshift(Number(rest.slice(-3)));
    rest = rest.slice(0, -3);
  }
  groups.unshift(Number(rest));

  const SCALES = ["", " thousand", " million", " billion", " trillion"];
  return groups
    .map((group, index) =>
      group === 0 ? "" : under1000(group) + SCALES[groups.length - 1 - index],
    )
    .filter(Boolean)
    .join(" ");
}

/**
 * 一个"含数字的记号"：字母/数字/`_` `#` `/` `.` `,` `%` `-` 组成，且至少含一个数字。
 * 句末标点会被剥回去（`12.` 是句末句号，不是小数），所以这里可以先吞进来。
 */
const TOKEN = /[A-Za-z0-9_#/.%,-]*\d[A-Za-z0-9_#/.%,-]*/g;
const TRAILING = /[.,-]+$/;

type Piece = { kind: "digits" | "letters" | "sep"; text: string };

/** 段内读法：先切成"数字组/字母/分隔符"三类片段，再按邻居决定怎么拼。 */
function readPlainSegment(seg: string, digitMode = false): string {
  if (!digitMode && /^\d+$/.test(seg)) return cardinal(seg);
  // 逗号只当千分位（必须是规整的三位分组）。"80,443" 这类端口列表因此走进
  // 下面的逐段分支，读成 "eighty four four three"，不会被拼成一个六位数。
  if (!digitMode && /^\d{1,3}(,\d{3})+$/.test(seg)) return cardinal(seg);
  if (!digitMode && /^\d{1,3}(,\d{3})+%$/.test(seg)) {
    return `${cardinal(seg.slice(0, -1))} percent`;
  }
  if (!digitMode && /^\d+%$/.test(seg)) {
    return `${cardinal(seg.slice(0, -1))} percent`;
  }

  const pieces: Piece[] = [];
  let i = 0;
  while (i < seg.length) {
    const ch = seg[i];
    if (/\d/.test(ch)) {
      let j = i;
      while (j < seg.length && /\d/.test(seg[j])) j++;
      const group = seg.slice(i, j);
      const before = seg[i - 1] ?? "";
      const after = seg[j] ?? "";
      // 紧邻字母、下划线、井号、斜杠 → 逐位（sha256 / x86_64 / #42），
      // 否则按基数词（10-20 / 2026）
      const identifierish =
        /[A-Za-z_#/]/.test(before) || /[A-Za-z_/]/.test(after);
      pieces.push({
        kind: "digits",
        text:
          digitMode || identifierish ? digitByDigit(group) : cardinal(group),
      });
      i = j;
    } else if (/[A-Za-z#]/.test(ch)) {
      let j = i;
      while (j < seg.length && /[A-Za-z#]/.test(seg[j])) j++;
      pieces.push({ kind: "letters", text: seg.slice(i, j) });
      i = j;
    } else {
      pieces.push({ kind: "sep", text: ch });
      i += 1;
    }
  }

  let out = "";
  for (let k = 0; k < pieces.length; k++) {
    const piece = pieces[k];
    if (piece.kind === "sep") {
      // 只有"数字-数字"才保留连字符（10-20 → ten-twenty）；
      // 其余分隔符（_ % , .）等价于一个空格
      const glue =
        piece.text === "-" &&
        pieces[k - 1]?.kind === "digits" &&
        pieces[k + 1]?.kind === "digits";
      if (glue) out += "-";
      else if (!out.endsWith(" ")) out += " ";
      continue;
    }
    if (out && !out.endsWith(" ") && !out.endsWith("-")) out += " ";
    out += piece.text;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/** 点分（小数/版本）每段一律逐位；其余交给 readPlainSegment。 */
function readToken(token: string): string {
  if (token.includes(".")) {
    return token
      .split(".")
      .map((seg) => readPlainSegment(seg, true))
      .join(" point ");
  }
  return readPlainSegment(token);
}

export function expandEnglishNumbers(text: string): string {
  // 全角数字先转半角，否则一条也匹配不到
  const normalized = text.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  const replaced = normalized.replace(TOKEN, (match) => {
    const trailing = match.match(TRAILING)?.[0] ?? "";
    const body = trailing ? match.slice(0, -trailing.length) : match;
    if (!body) return match;
    return readToken(body) + trailing;
  });
  // 空段（".5" 这种）会在拼接处留下双空格；口播文本合并空白
  return replaced.replace(/\s{2,}/g, " ");
}
