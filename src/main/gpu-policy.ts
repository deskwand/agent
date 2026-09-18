/**
 * Keep Linux on software rendering by default because Vulkan/ANGLE can fail
 * in headless, SSH, or misconfigured X11/Wayland environments. macOS and
 * Windows use Electron's default acceleration unless safe mode is requested.
 */
export function shouldDisableHardwareAcceleration(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean {
  if (env.DESKWAND_DISABLE_GPU === "1") return true;
  return platform === "linux" && env.DESKWAND_ENABLE_GPU !== "1";
}
