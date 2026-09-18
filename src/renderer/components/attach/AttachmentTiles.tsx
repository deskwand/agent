// 附件磁贴：图片与文件用同一种方块磁贴横排（设计文档 §4.3）。
// 卡片高度不再按"一个附件一行"线性增长，改为每行放满为止。
import { FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type AttachmentTile =
  | {
      kind: "image";
      key: string;
      url: string;
      alt: string;
      onOpen: () => void;
      onRemove: () => void;
    }
  | {
      kind: "file";
      key: string;
      name: string;
      /** 悬浮提示：非密库 = 完整路径，密库 = 「密库 · 文件名」*/
      hint: string;
      /** 图片型附件仍可点击开大图；普通文件不传，磁贴就是纯展示 */
      onOpen?: () => void;
      onRemove: () => void;
    };

/** 7rem = 112px；圆角取 tailwind.config.js 的 2xl = 14px。 */
const TILE_CLASS = "group/tile relative h-28 w-28 overflow-hidden rounded-2xl";

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // 磁贴本身可能有 onClick（打开大图），删除键不能把事件冒泡上去 ——
      // 否则"删掉这张图"会顺带用删除前的列表打开一次大图。
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-error text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover/tile:opacity-100"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

export function AttachmentTiles({ tiles }: { tiles: AttachmentTile[] }) {
  const { t } = useTranslation();
  if (tiles.length === 0) return null;

  const removeLabel = t("attachTile.remove");

  return (
    <div className="mb-3 flex flex-wrap gap-3">
      {tiles.map((tile) => {
        if (tile.kind === "image") {
          return (
            <div key={tile.key} className={TILE_CLASS}>
              <img
                src={tile.url}
                alt={tile.alt}
                onClick={tile.onOpen}
                className="block h-full w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
              />
              <RemoveButton label={removeLabel} onClick={tile.onRemove} />
            </div>
          );
        }

        return (
          <div
            key={tile.key}
            title={tile.hint}
            onClick={tile.onOpen}
            className={`${TILE_CLASS} flex flex-col items-center justify-center bg-surface-muted px-2${tile.onOpen ? " cursor-pointer hover:bg-surface-hover" : ""}`}
          >
            <FileText
              className="h-6 w-6 shrink-0 text-text-muted"
              aria-hidden="true"
            />
            <span className="mt-1.5 line-clamp-2 w-full break-all text-center text-[11px] leading-tight text-text-primary">
              {tile.name}
            </span>
            <RemoveButton label={removeLabel} onClick={tile.onRemove} />
          </div>
        );
      })}
    </div>
  );
}
