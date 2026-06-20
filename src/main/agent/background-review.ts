/**
 * @module main/agent/background-review
 *
 * Background review service — spawns a lightweight AgentRunner fork after
 * each turn (when conditions are met) to review the conversation and
 * create/patch/extend skills.
 *
 * In Hermes Agent, ``spawn_background_review_thread`` forks the full AIAgent
 * with a whitelist of skill_manage + memory tools.
 * In deskwand, a light AgentRunner fork replaces Hermes' Python AIAgent fork.
 *
 * Adapted from Hermes Agent background_review.py:400-608
 */

import * as os from "node:os";
import { AgentRunner } from "./agent-runner";
import { PathResolver } from "../sandbox/path-resolver";
import { buildSkillWriteTools } from "../skills/skill-write-tools";
import { buildMemoryWriteTools } from "../memory/memory-write-tools";
import { BACKGROUND_REVIEW_SYSTEM_PROMPT } from "./review-prompts";
import { log, logError } from "../utils/logger";
import type { AppConfig } from "../config/config-store";
import type { CoreMemoryStore } from "../memory/core-memory-store";
import type { SkillsAdapter } from "../skills/skills-adapter";
import type { Session, Message } from "../../renderer/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewTurnSnapshot {
  /** Messages from the current turn (user + assistant). */
  messages: Array<{ role: string; content: string }>;
}

export interface BackgroundReviewOptions {
  config: AppConfig;
  globalSkillsPath: string;
  coreStore?: CoreMemoryStore;
  pathResolver: PathResolver;
  skillsAdapter?: SkillsAdapter;
  /** Timeout in ms for the review agent runner (default 120s). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BackgroundReviewService {
  private readonly options: BackgroundReviewOptions;

  constructor(options: BackgroundReviewOptions) {
    this.options = options;
  }

  /**
   * Review a turn snapshot by forking a lightweight AgentRunner.
   *
   * The forked runner can use skill_create/skill_patch/skill_add_reference
   * to write new skills, and read to inspect existing ones.  Memory tools
   * (memory_upsert/memory_delete) are also available.
   *
   * Fire-and-forget: errors are logged, never thrown to the caller.
   */
  async review(snapshot: ReviewTurnSnapshot): Promise<void> {
    const startTime = Date.now();
    log("[BackgroundReview] Starting review with AgentRunner fork...");

    try {
      // 1. Build the review prompt (conversation snapshot as user message)
      const turnText = snapshot.messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join("\n\n");
      const prompt = `Review this conversation turn and decide if any skills or memory entries should be created or updated.

## Conversation

${turnText}

Start by using read to check what skills already exist before creating or
patching. If nothing needs to change, that's fine — but don't miss obvious
learning opportunities.`;

      // 2. Build the review tool set
      const reviewTools = [
        ...buildSkillWriteTools({
          globalSkillsPath: this.options.globalSkillsPath,
          onSkillChanged: () => {
            log("[BackgroundReview] Skill changed, hot-reload triggered");
          },
        }),
      ];
      const { coreStore } = this.options;
      if (coreStore) {
        reviewTools.push(...buildMemoryWriteTools({ coreStore }));
      }

      // 3. Create a lightweight AgentRunner fork
      //    - no-op sendToRenderer (never leaks to UI)
      //    - no MCP, no extensions, no browser
      //    - no turnFinalizer (prevents recursion)
      //    - only review tools as customTools
      const reviewRunner = new AgentRunner(
        {
          sendToRenderer: () => {},
          customTools: reviewTools,
        },
        this.options.pathResolver,
        undefined, // MCPManager
        this.options.skillsAdapter,
        undefined, // ExtensionManager
        undefined, // BrowserViewManager
      );

      // 4. Build a temporary session for the fork
      const reviewSession: Session = {
        id: `bg-review-${Date.now()}`,
        title: "",
        deskwandSessionId: "",
        status: "idle",
        cwd: os.homedir(),
        mountedPaths: [],
        allowedTools: reviewTools.map((t) => t.name),
        memoryEnabled: false,
        isProjectMode: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // 5. Run — the model reads existing skills, decides, calls tools
      const messages: Message[] = [
        {
          id: `bg-review-sys-${Date.now()}`,
          sessionId: reviewSession.id,
          role: "system" as Message["role"],
          content: [{ type: "text", text: BACKGROUND_REVIEW_SYSTEM_PROMPT }],
          timestamp: Date.now(),
        },
      ];

      await reviewRunner.run(reviewSession, prompt, messages);

      log(`[BackgroundReview] Completed in ${Date.now() - startTime}ms`);
    } catch (err) {
      logError("[BackgroundReview] Failed:", err);
    }
  }
}
