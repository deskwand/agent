/**
 * 最小终端屏幕缓冲：解析 pi-tui 差分输出中的 CSI 子集，
 * 维护行数组并输出完整屏幕文本（SGR 颜色序列保留给 renderer 上色）。
 *
 * 支持的 CSI 子集（pi-tui 实际输出）：
 *   \r         光标到行首
 *   \n         换行
 *   \x1b[2K    清当前行
 *   \x1b[K     清到行尾
 *   \x1b[2J / \x1b[3J  清屏
 *   \x1b[H     光标到 0,0
 *   \x1b[nA / \x1b[nB  光标上下移动
 *   \x1b[?2026h/l、\x1b[?25h/l 等 忽略（同步标记/光标显隐）
 *   其他 CSI（SGR 颜色等） 附加到当前行原样保留
 */

const CSI_RE = /^\x1b\[([0-9;?]*)([A-Za-z])/;
const OSC_RE = /^\x1b\][^\x07]*(\x07|\x1b\\)/;

export class AnsiScreenBuffer {
  private rows: string[] = [];
  private row = 0;
  private col = 0;

  reset(): void {
    this.rows = [];
    this.row = 0;
    this.col = 0;
  }

  /** 应用一个 ANSI chunk，返回完整屏幕文本（行以 \n 连接）。 */
  apply(chunk: string): string {
    let i = 0;
    while (i < chunk.length) {
      const ch = chunk[i];
      if (ch === "\r") {
        this.col = 0;
        i++;
        continue;
      }
      if (ch === "\n") {
        this.row++;
        this.col = 0;
        i++;
        continue;
      }
      if (ch === "\x1b") {
        const rest = chunk.slice(i);
        const osc = OSC_RE.exec(rest);
        if (osc) {
          i += osc[0].length;
          continue;
        }
        const csi = CSI_RE.exec(rest);
        if (csi) {
          i += csi[0].length;
          this.handleCsi(csi[1], csi[2]);
          continue;
        }
        // 无法识别的 ESC 序列：跳过该字符
        i++;
        continue;
      }
      // 普通字符：写入当前行（覆盖模式）
      this.writeChar(ch);
      i++;
    }
    return this.snapshot();
  }

  /** 完整屏幕文本（去尾空行）。 */
  snapshot(): string {
    while (this.rows.length > 0 && this.rows[this.rows.length - 1] === "") {
      this.rows.pop();
    }
    return this.rows.join("\n");
  }

  private writeChar(ch: string): void {
    while (this.rows.length <= this.row) {
      this.rows.push("");
    }
    const line = this.rows[this.row] ?? "";
    if (this.col >= line.length) {
      this.rows[this.row] = line + ch;
    } else {
      // 覆盖模式：替换目标位置字符（SGR 序列按单字符处理会错位，
      // 但 TUI 差分输出通常整行重写，覆盖场景罕见）
      this.rows[this.row] = line.slice(0, this.col) + ch + line.slice(this.col + 1);
    }
    this.col++;
  }

  private handleCsi(params: string, final: string): void {
    const nums = params
      .split(";")
      .map((p) => parseInt(p, 10))
      .filter((n) => !Number.isNaN(n));
    switch (final) {
      case "J": {
        const mode = nums[0] ?? 0;
        if (mode === 2 || mode === 3) {
          this.rows = [];
          this.row = 0;
          this.col = 0;
        }
        break;
      }
      case "K": {
        const mode = nums[0] ?? 0;
        const line = this.rows[this.row] ?? "";
        if (mode === 2) {
          this.rows[this.row] = "";
          this.col = 0;
        } else if (mode === 0) {
          this.rows[this.row] = line.slice(0, this.col);
        }
        break;
      }
      case "H": {
        this.row = Math.max(0, (nums[0] ?? 1) - 1);
        this.col = Math.max(0, (nums[1] ?? 1) - 1);
        break;
      }
      case "A": {
        this.row = Math.max(0, this.row - (nums[0] ?? 1));
        break;
      }
      case "B": {
        this.row += nums[0] ?? 1;
        break;
      }
      default:
        // SGR（m）及其它 CSI：原样保留到当前行，供 renderer 上色
        if (final === "m") {
          const line = this.rows[this.row] ?? "";
          this.rows[this.row] = line + `\x1b[${params}m`;
          this.col = this.rows[this.row].length; // SGR 后光标跟随行尾
        }
        break;
    }
  }
}
