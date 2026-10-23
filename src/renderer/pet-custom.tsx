import { useEffect, useState } from "react";
import type { PetState } from "../main/desktop-pet/pet-state";
import { applyPetCutout } from "./pet-cutout-apply";

export function PetCustom({
  state,
  src,
  onError,
}: {
  state: PetState;
  src: string;
  onError: () => void;
}) {
  const [processed, setProcessed] = useState<{
    forSrc: string;
    dataUrl: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void applyPetCutout(src)
      .then((next) => {
        if (!cancelled && next) setProcessed({ forSrc: src, dataUrl: next });
      })
      .catch(() => {
        // 抠图失败保持原图；绝不让异常冒到渲染层。
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // 新图还没处理完时立刻回到原图，不能把上一张的抠图结果留在屏幕上。
  const displaySrc = processed?.forSrc === src ? processed.dataUrl : src;

  return (
    <div className="pet-custom" data-state={state} aria-hidden="true">
      <img
        className="pet-custom__img"
        src={displaySrc}
        alt=""
        draggable={false}
        onError={onError}
      />
    </div>
  );
}
