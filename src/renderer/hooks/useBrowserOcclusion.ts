import { useId, useLayoutEffect } from "react";
import { useAppStore } from "../store";

/** Hide the native browser view while this blocking renderer modal is active. */
export function useBrowserOcclusion(active: boolean): void {
  const id = useId();

  useLayoutEffect(() => {
    if (!active) return;

    useAppStore.getState().acquireBrowserOcclusion(id);
    return () => {
      useAppStore.getState().releaseBrowserOcclusion(id);
    };
  }, [active, id]);
}
