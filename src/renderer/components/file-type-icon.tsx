import type { FileKind } from "../utils/file-types";

interface TilePath {
  /** 24×24 网格上的 path 数据 */
  d: string;
  /** true = 在色块上画白色实心；false = 白色描边（1.85px，圆头圆角） */
  filled?: boolean;
  /** 实心形的填充不透明度，用于做 Finder 式文件夹的前后层次 */
  opacity?: number;
}

/** 关闭态文件夹：后板 + 与之齐平的前板，靠明度差做出前后层次 */
const FOLDER_CLOSED: TilePath[] = [
  {
    d: "M2.6 12.8V6.5A1.7 1.7 0 0 1 4.3 4.8h4.2a1.7 1.7 0 0 1 1.36.68l1.3 1.72h8.14a1.7 1.7 0 0 1 1.7 1.7v3.9z",
    filled: true,
  },
  {
    d: "M2.6 12.8h18.4v6.1a1.7 1.7 0 0 1-1.7 1.7H4.3a1.7 1.7 0 0 1-1.7-1.7z",
    filled: true,
    opacity: 0.78,
  },
];

/** 展开态文件夹：后板缩短，前板向下前方倾斜，露出后板内腔 */
const FOLDER_OPEN: TilePath[] = [
  {
    d: "M2.6 11.4V6.5A1.7 1.7 0 0 1 4.3 4.8h4.2a1.7 1.7 0 0 1 1.36.68l1.3 1.72h8.14a1.7 1.7 0 0 1 1.7 1.7v2.5z",
    filled: true,
  },
  {
    d: "M7.4 11.4H21l-2.4 9.2H3.4z",
    filled: true,
    opacity: 0.78,
  },
];

const TILE_GLYPHS: Record<FileKind, TilePath[]> = {
  folder: FOLDER_CLOSED,
  image: [
    { d: "M9 6.2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z", filled: true },
    {
      d: "M2.4 19 8 13.6a2 2 0 0 1 2.8 0l2.4 2.4 1.5-1.5a2 2 0 0 1 2.8 0l4.1 4.5z",
      filled: true,
    },
  ],
  video: [{ d: "M9.8 7.6 17 12l-7.2 4.4z", filled: true }],
  audio: [
    { d: "M9.6 17.4V8.2l6.6-1.6v9.2" },
    { d: "M9.6 17.4a2 2 0 1 1-4 0 2 2 0 0 1 4 0z", filled: true },
    { d: "M16.2 15.8a2 2 0 1 1-4 0 2 2 0 0 1 4 0z", filled: true },
  ],
  doc: [
    { d: "M6.6 5.6h6.6l4.2 4.2v8.6H6.6z" },
    { d: "M13.2 5.6v4.2h4.2" },
    { d: "M9.4 13.4h5.2" },
    { d: "M9.4 16h3.4" },
  ],
  sheet: [
    { d: "M4.6 6.4h14.8v11.2H4.6z" },
    { d: "M4.6 10.2h14.8" },
    { d: "M4.6 13.9h14.8" },
    { d: "M10.4 6.4v11.2" },
    { d: "M14.9 6.4v11.2" },
  ],
  code: [
    { d: "m8.4 8.6-3.6 3.4 3.6 3.4" },
    { d: "m15.6 8.6 3.6 3.4-3.6 3.4" },
    { d: "m13.4 6.4-2.8 11.2" },
  ],
  archive: [
    { d: "M5 6.6h14v11H5z" },
    { d: "M11.2 6.6v2.6M12.8 9.2v2.6M11.2 11.8v2.6" },
    { d: "M10.6 14.4h2.8v3.2h-2.8z" },
  ],
  file: [{ d: "M6.8 5.4h6.4l4.2 4.2v9H6.8z" }, { d: "M13.2 5.4v4.2h4.2" }],
};

/** kind → 色块颜色。② 决策：按家族收色，字形负责精确类型。 */
const KIND_TILE_CLASS: Record<FileKind, string> = {
  folder: "fill-file-folder",
  image: "fill-file-media",
  video: "fill-file-media",
  doc: "fill-file-doc",
  sheet: "fill-file-doc",
  code: "fill-file-code",
  audio: "fill-file-audio",
  archive: "fill-file-neutral",
  file: "fill-file-neutral",
};

const STROKE_PROPS = {
  strokeWidth: 1.85,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function FileTypeIcon({
  kind,
  expanded,
  size = 16,
}: {
  kind: FileKind;
  expanded?: boolean;
  size?: number;
}) {
  const glyphs =
    kind === "folder" && expanded ? FOLDER_OPEN : TILE_GLYPHS[kind];
  const radius = size <= 16 ? 4.6 : 6;
  // 目前只用到 16（文件管理器、产出面板）与 24（密库）两档，其余尺寸线性外推到 6。
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="presentation"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="1.4"
        y="1.4"
        width="21.2"
        height="21.2"
        rx={radius}
        className={KIND_TILE_CLASS[kind]}
      />
      {glyphs.map((glyph) =>
        glyph.filled ? (
          <path
            key={glyph.d}
            d={glyph.d}
            fillOpacity={glyph.opacity}
            className="fill-white"
          />
        ) : (
          <path
            key={glyph.d}
            d={glyph.d}
            className="fill-none stroke-white"
            {...STROKE_PROPS}
          />
        ),
      )}
    </svg>
  );
}
