/**
 * Agent 列表扫描器 — 扫描内置 Agent 及全局/项目级 Markdown Agent。
 *
 * 优先级：项目 > 全局 > 内置。同名 Agent 高优先级覆盖。
 */

import { readdirSync, readFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { log } from "../../utils/logger";

export interface AgentDescriptor {
  name: string;
  displayName: string;
  description: string;
  source: "builtin" | "global" | "project";
  markdownPath?: string;
  markdownModel?: string;
  markdownThinking?: string;
  tools?: string[];
  disallowedTools?: string[];
}

const BUILTIN: AgentDescriptor[] = [
  {
    name: "general-purpose",
    displayName: "Agent",
    description:
      "General-purpose agent for researching complex questions and executing multi-step tasks.",
    source: "builtin",
  },
  {
    name: "Explore",
    displayName: "Explore",
    description:
      "Fast read-only code explorer. Locate files, trace implementations, answer where/how questions.",
    source: "builtin",
  },
  {
    name: "Plan",
    displayName: "Plan",
    description:
      "Read-only architecture and implementation planner. Turn goals into concrete step-by-step plans.",
    source: "builtin",
  },
];

/**
 * 简化的 YAML frontmatter 解析（不需要 jiti/yaml 依赖）。
 */
function parseSimpleFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const lines = match[1].split("\n");
  const fm: Record<string, unknown> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    if (val.startsWith('"') && val.endsWith('"')) {
      fm[key] = val.slice(1, -1);
    } else if (val === "true" || val === "false") {
      fm[key] = val === "true";
    } else if (/^\[.*\]$/.test(val)) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim());
    } else {
      fm[key] = val;
    }
  }

  return fm;
}

function loadFromDir(
  dir: string,
  source: "global" | "project",
): AgentDescriptor[] {
  const agents: AgentDescriptor[] = [];
  if (!existsSync(dir)) return agents;

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return agents;
  }

  for (const file of files) {
    const name = basename(file, ".md");
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf-8");
    } catch {
      continue;
    }

    const fm = parseSimpleFrontmatter(content);

    agents.push({
      name: (fm.name as string) || name,
      displayName:
        (fm.display_name as string) || (fm.name as string) || name,
      description: (fm.description as string) || "",
      source,
      markdownPath: join(dir, file),
      markdownModel: fm.model as string | undefined,
      markdownThinking: fm.thinking as string | undefined,
      tools: Array.isArray(fm.tools) ? (fm.tools as string[]) : undefined,
      disallowedTools: Array.isArray(fm.disallowed_tools)
        ? (fm.disallowed_tools as string[])
        : undefined,
    });
  }

  return agents;
}

/**
 * 扫描所有可用 Agent。
 * 优先级：项目 > 全局 > 内置。同名 Agent 高优先级覆盖。
 */
export function scanAgents(cwd: string): AgentDescriptor[] {
  const map = new Map<string, AgentDescriptor>();

  // 内置（最低优先级）
  for (const a of BUILTIN) {
    map.set(a.name, a);
  }

  // 全局
  const globalDir = join(getAgentDir(), "agents");
  for (const a of loadFromDir(globalDir, "global")) {
    map.set(a.name, a);
  }

  // 项目（最高优先级）
  const projectDir = join(cwd, ".pi", "agents");
  for (const a of loadFromDir(projectDir, "project")) {
    map.set(a.name, a);
  }

  return [...map.values()];
}

/**
 * 将 DeskWand 内置 Agent Markdown 文件部署到全局 Agent 目录。
 * 在 AgentRunner 初始化时调用，确保插件可以发现这些 Agent。
 *
 * cp -n 语义：如果目标文件已存在则跳过，不覆盖用户修改。
 */
export function deployBuiltinAgents(): void {
  const targetDir = join(getAgentDir(), "agents");

  // 源目录：与 .deskwand/skills 同级
  const sourceCandidates = [
    join(dirname(dirname(dirname(dirname(__dirname)))), ".deskwand", "agents"),
    join(process.resourcesPath || "", "agents"),
  ];

  let sourceDir: string | undefined;
  for (const candidate of sourceCandidates) {
    if (existsSync(candidate)) {
      sourceDir = candidate;
      break;
    }
  }
  if (!sourceDir) {
    log("[AgentList] No builtin agents dir found, skipping deploy");
    return;
  }

  try {
    mkdirSync(targetDir, { recursive: true });
  } catch {
    return;
  }

  let deployed = 0;
  for (const file of ["Explore.md", "Plan.md", "general-purpose.md"]) {
    const target = join(targetDir, file);
    if (existsSync(target)) continue;  // cp -n
    try {
      copyFileSync(join(sourceDir, file), target);
      deployed++;
    } catch {
      // skip individual file errors
    }
  }

  log(`[AgentList] Deployed ${deployed} built-in agent(s) to ${targetDir}`);
}
