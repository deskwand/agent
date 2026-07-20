/**
 * 子 Agent 模型优先级策略解析器。
 *
 * 优先级：
 * 1. DeskWand 设置页 Agent 专属覆盖
 * 2. Agent Markdown 中的 model
 * 3. Agent 工具调用中的临时 model
 * 4. 全局默认子 Agent 模型
 * 5. 抛出错误
 *
 * "inherit" 是明确的主动选择，不是故障恢复路径。
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
  SubagentDefaultModel,
} from "../../../shared/subagent-config";
import { buildDeskWandModelId, resolveDeskWandModel } from "./provider-bridge";
import { log } from "../../utils/logger";

export interface ResolveSubagentModelInput {
  agentName: string;
  markdownModel?: string;
  runtimeModel?: string;
  parentModel: Model<any>;
  registry: ModelRegistry;
  defaultModel: SubagentDefaultModel;
}

/**
 * 检查模型字符串是否表示"跟随主模型"。
 */
function isInheritSignal(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower === "inherit";
}

/**
 * 从 registry 中查找模型。尝试 DeskWand 命名空间，
 * 如果失败则尝试直接 provider/model 查找。
 */
function findModelInRegistry(
  modelSpec: string,
  registry: ModelRegistry,
): Model<any> | undefined {
  const model = resolveDeskWandModel(modelSpec, registry);
  if (model) return model;

  // 也尝试直接查找（用于非 DeskWand 的 provider/model）
  const slashIdx = modelSpec.indexOf("/");
  if (slashIdx !== -1) {
    const provider = modelSpec.slice(0, slashIdx);
    const modelId = modelSpec.slice(slashIdx + 1);
    return registry.find(provider, modelId) as Model<any> | undefined;
  }

  return undefined;
}

function resolveDefault(
  agentName: string,
  defaultModel: SubagentDefaultModel,
  parentModel: Model<any>,
  registry: ModelRegistry,
): Model<any> {
  if (defaultModel.mode === "inherit") {
    log(`[SubagentModel] "${agentName}" → inherit (global default)`);
    return parentModel;
  }

  if (defaultModel.mode === "model") {
    const modelId = buildDeskWandModelId(
      defaultModel.providerProfileKey,
      defaultModel.modelId,
    );
    const model = findModelInRegistry(modelId, registry);
    if (model) {
      log(`[SubagentModel] "${agentName}" → ${modelId} (global default)`);
      return model;
    }
    throw new Error(
      `Global default model "${modelId}" not found for agent "${agentName}". ` +
        `Check that the provider profile exists and the model is available.`,
    );
  }

  throw new Error(
    `No model configured for subagent "${agentName}". ` +
      `Configure a global default subagent model in Settings → API, or set a per-agent model override.`,
  );
}

/**
 * 按优先级解析子 Agent 最终使用的模型。
 *
 * 返回值永远不会是 undefined — 无法解析时抛出错误。
 */
export function resolveSubagentModel(
  input: ResolveSubagentModelInput,
): Model<any> {
  const {
    agentName,
    markdownModel,
    runtimeModel,
    parentModel,
    registry,
    defaultModel: globalDefault,
  } = input;

  // 1. Markdown model （原 priority 1 Settings override 已移除，由 Markdown 统一管理）
  if (markdownModel) {
    if (isInheritSignal(markdownModel)) {
      log(`[SubagentModel] "${agentName}" → inherit (markdown)`);
      return parentModel;
    }
    const model = findModelInRegistry(markdownModel, registry);
    if (model) {
      log(`[SubagentModel] "${agentName}" → ${markdownModel} (markdown)`);
      return model;
    }
    log(
      `[SubagentModel] "${agentName}" markdown model "${markdownModel}" not found, falling to next priority`,
    );
  }

  // 2. Runtime model （原 priority 3）
  if (runtimeModel) {
    if (isInheritSignal(runtimeModel)) {
      log(`[SubagentModel] "${agentName}" → inherit (runtime)`);
      return parentModel;
    }
    const model = findModelInRegistry(runtimeModel, registry);
    if (model) {
      log(`[SubagentModel] "${agentName}" → ${runtimeModel} (runtime)`);
      return model;
    }
    log(
      `[SubagentModel] "${agentName}" runtime model "${runtimeModel}" not found, falling to next priority`,
    );
  }

  // 4. Global default
  return resolveDefault(agentName, globalDefault, parentModel, registry);
}
