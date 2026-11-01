import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";

interface PartnerAvatarProps {
  seed: string;
  size: number;
  className?: string;
}

/** 伙伴头像：DiceBear Notionists 按种子离线生成（画作 CC0），同一种子永远同一张脸。 */
export function PartnerAvatar({
  seed,
  size,
  className = "",
}: PartnerAvatarProps) {
  const src = useMemo(
    () => createAvatar(notionists, { seed }).toDataUri(),
    [seed],
  );
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 rounded-full bg-muted ${className}`}
    />
  );
}
