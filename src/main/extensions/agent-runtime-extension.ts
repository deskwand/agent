import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import type { Message, Session } from "../../renderer/types";

export type AgentRuntimeCustomTool = ToolDefinition<TSchema, unknown>;

export interface BeforeSessionRunContext {
  session: Session;
  prompt: string;
  existingMessages: Message[];
  isColdStart: boolean;
}

export interface BeforeSessionRunResult {
  promptPrefix?: string;
  customTools?: AgentRuntimeCustomTool[];
}

export interface AfterSessionRunContext {
  session: Session;
  prompt: string;
  messages: Message[];
}

export interface AfterSessionRunResult {
  continuePrompt?: string;
  goalStatus?: {
    status: "active" | "paused" | "complete" | "cleared" | "blocked" | "budget_limited";
    objective?: string;
    iteration?: number;
    tokensUsed?: number;
    tokenBudget?: number;
    timeUsedSeconds?: number;
    timeBudgetSeconds?: number;
  };
}

export interface CommandContext {
  command: string;
  args: string;
  sessionId: string;
}

export interface CommandResult {
  handled: boolean;
  message?: string;
  firstTurnPrompt?: string;
  goalStatus?: AfterSessionRunResult["goalStatus"];
}

export interface SessionDeletedContext {
  sessionId: string;
  session?: Session | null;
}

export interface AgentRuntimeExtension {
  name: string;
  beforeSessionRun?(
    context: BeforeSessionRunContext,
  ): Promise<BeforeSessionRunResult | void>;
  afterSessionRun?(context: AfterSessionRunContext): Promise<AfterSessionRunResult | void>;
  onCommand?(context: CommandContext): Promise<CommandResult | void>;
  onSessionDeleted?(context: SessionDeletedContext): Promise<void>;
}
