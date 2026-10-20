import { parseWorkspaceCwd } from "../../shared/workspace-cwd";

export interface FilePreviewCapability {
  office: boolean;
  systemApp: boolean;
  revealInFinder: boolean;
  binaryPreview: boolean;
}

export function filePreviewCapability(cwd: string): FilePreviewCapability {
  const isRemote = parseWorkspaceCwd(cwd).kind === "ssh";
  return {
    office: !isRemote,
    systemApp: !isRemote,
    revealInFinder: !isRemote,
    binaryPreview: !isRemote,
  };
}
