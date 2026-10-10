/**
 * 设置页色卡（下拉项与触发器上那一小方块 / 圆点）的取色表。
 *
 * 色值**不在这里写死**：直接读官方 registry 快照 `styles/official-*.json`。
 * 那两个快照已经被守卫测试与 `globals.css` 的主题块逐值绑死
 * （`official-vocabulary.test.ts` 管底色、`accent-layer.test.ts` 管强调色），
 * 所以这里只是给同一个真值多接一个消费者，不引入第二份真源 ——
 * 要换色仍然是改 `globals.css`（挪快照会红）。
 *
 * 取哪个变量：
 * - 底色（调色板）→ 该套配色的**中性中间调**，见 `paletteSwatchColor` 的注释。
 * - 强调色 → `--primary`。`"default"` 不叠强调色层，主色由底色决定，取底色的 `--primary`。
 *
 * 强调色的明暗由调用方传当前生效主题（`useEffectiveTheme`），色卡因此显示的是
 * "此刻真的会得到"的那个值。
 */
import officialThemes from "../styles/official-themes.json";
import officialAccents from "../styles/official-accents.json";
import type { ThemeAccent, ThemePreset } from "../../shared/theme";

/** 与 `selectEffectiveTheme()` 的返回一致（"跟随系统"在调用方已经解析成明或暗）。 */
type ThemeMode = "dark" | "light";

/**
 * 调色板色卡：该套配色的中性中间调（相当于暗色 `--ring`）。
 *
 * 为什么不照当前模式取 `[mode].ring`：官方把这套配色的中性色放在两个槽位里，明暗
 * **互换** —— 暗色 `--ring` = 亮色 `--muted-foreground`（同一个值，L≈0.55、色度在这
 * 31 个变量里最高：mauve 0.034 / olive 0.031）；另一半（亮色 `--ring`、暗色
 * `--muted-foreground`）是 0.70 的浅灰。照模式取的话，亮色主题下色块会换成那块浅灰，
 * 落在白底上只有约 2.1:1，几乎看不出色调（暗色下同为 0.55 那档反而正常）。
 * 所以这里固定取 0.55 那档：明暗两套下观感一致，色块的职责本来也只是标出这套配色的色调。
 * "两个槽位逐值相等"由 `theme-swatch.test.ts` 钉着 —— 官方哪天把两档拆开，那条会红，
 * 那时再按明暗真的选一次。
 */
export function paletteSwatchColor(preset: ThemePreset): string {
  return officialThemes[preset].dark.ring;
}

/** 强调色色卡：该强调色的主色（`--primary`）；`default` = 当前底色自己的主色。 */
export function accentSwatchColor(
  accent: ThemeAccent,
  mode: ThemeMode,
  basePreset: ThemePreset,
): string {
  if (accent === "default") return officialThemes[basePreset][mode].primary;
  return officialAccents[accent][mode].primary;
}
