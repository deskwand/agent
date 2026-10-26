import type { TraceStep } from "../types";
import {
  extractFilePathFromToolInput,
  extractFilePathFromToolOutput,
} from "./tool-output-path";
import { resolveArtifactPath } from "./artifact-path";

const FILE_TOOL_NAMES = new Set([
  "write_file",
  "edit_file",
  "Write",
  "Edit",
  "write",
  "edit",
  "NotebookEdit",
  "notebook_edit",
]);

function isReliablePathToolName(toolName: string | undefined): boolean {
  if (!toolName) {
    return false;
  }
  if (FILE_TOOL_NAMES.has(toolName)) {
    return true;
  }

  const normalized = toolName.trim().toLowerCase();
  return /(?:^|__|_)(?:screenshot|take_screenshot|capture_screenshot)(?:$|__|_)/.test(
    normalized,
  );
}

type ArtifactStepResult = {
  artifactSteps: TraceStep[];
  fileSteps: TraceStep[];
  displayArtifactSteps: TraceStep[];
};

export function getArtifactLabel(pathValue: string, name?: string): string {
  const trimmedName = name?.trim();
  const trimmedPath = pathValue.trim();
  if (trimmedPath) {
    const normalized = trimmedPath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || trimmedPath;
  }

  return trimmedName ?? "";
}

export function getArtifactSteps(steps: TraceStep[]): ArtifactStepResult {
  const artifactSteps = steps.filter(
    (step) => step.type === "tool_result" && step.toolName === "artifact",
  );

  const rawFileSteps = steps.filter((step) => {
    if (step.status !== "completed") {
      return false;
    }
    if (!isReliablePathToolName(step.toolName)) {
      return false;
    }
    const pathFromOutput = extractFilePathFromToolOutput(step.toolOutput);
    const pathFromInput = extractFilePathFromToolInput(step.toolInput);
    if (!pathFromOutput && !pathFromInput) {
      return false;
    }
    return step.type === "tool_result" || step.type === "tool_call";
  });

  // Keep only one entry per file path to avoid noisy duplicates.
  const seenPaths = new Set<string>();
  const fileSteps: TraceStep[] = [];
  for (let i = rawFileSteps.length - 1; i >= 0; i -= 1) {
    const step = rawFileSteps[i];
    const pathValue =
      extractFilePathFromToolOutput(step.toolOutput) ||
      extractFilePathFromToolInput(step.toolInput) ||
      "";
    const key = pathValue.trim();
    if (!key || seenPaths.has(key)) {
      continue;
    }
    seenPaths.add(key);
    fileSteps.unshift(step);
  }

  return {
    artifactSteps,
    fileSteps,
    displayArtifactSteps: [...artifactSteps, ...fileSteps],
  };
}

export interface ArtifactItem {
  label: string;
  path: string;
}

/** traceSteps → 去重后的产物条目（label + 解析后的绝对路径）。产物面板与概览共用。 */
export function buildArtifactItems(
  steps: TraceStep[],
  cwd: string | null | undefined,
): ArtifactItem[] {
  const { displayArtifactSteps } = getArtifactSteps(steps);
  const seen = new Set<string>();
  const items: ArtifactItem[] = [];

  for (const step of displayArtifactSteps) {
    const rawPath =
      extractFilePathFromToolOutput(step.toolOutput) ||
      extractFilePathFromToolInput(step.toolInput);
    if (!rawPath) continue;
    const resolvedPath = resolveArtifactPath(rawPath, cwd);
    const key = resolvedPath.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ label: getArtifactLabel(rawPath), path: resolvedPath });
  }

  return items;
}
