export type RightPanelMode = "files" | "browser" | null;

export function shouldSuppressVisibleBrowser(
  isFullScreenView: boolean,
  hasBrowserOcclusion: boolean,
): boolean {
  return isFullScreenView || hasBrowserOcclusion;
}

export function shouldShowBrowserView(
  rightPanelMode: RightPanelMode,
  isFullScreenView: boolean,
  hasBrowserOcclusion: boolean,
): boolean {
  return (
    rightPanelMode === "browser" &&
    !shouldSuppressVisibleBrowser(isFullScreenView, hasBrowserOcclusion)
  );
}
