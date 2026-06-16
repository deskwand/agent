/**
 * @module main/agent/turn-finalizer
 *
 * Hook executed after every agent turn completes.
 *
 * Determines whether a background review (skill + memory) should run,
 * based purely on a turn counter — same approach as Hermes Agent.
 *
 * Hermes uses _skill_nudge_interval (default 10 tool-iterations).
 * We use a turn-based interval (default 3 user→assistant turns) since
 * omagt counts full turns rather than individual tool-call iterations.
 *
 * No keyword matching, no heuristic signal detection. The LLM itself
 * decides whether the conversation snapshot contains anything worth
 * learning. This keeps the trigger logic simple and avoids the false-
 * negative problem of regex-based signal detection across languages
 * and phrasing styles.
 *
 * Adapted from Hermes Agent:
 *   - agent_init.py:1228  (_skill_nudge_interval)
 *   - turn_finalizer.py:376-381  (_should_review_skills)
 *   - background_review.py  (review prompt design)
 */

import { log, logError } from "../utils/logger";
import {
  BackgroundReviewService,
  type ReviewTurnSnapshot,
} from "./background-review";
import { configStore } from "../config/config-store";
import type { Message } from "../../renderer/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TurnCompleteParams {
  /** The session ID (for logging). */
  sessionId: string;
  /** All messages from the conversation so far. */
  messages: Message[];
  /** Whether the model produced a final response (not interrupted). */
  hasFinalResponse: boolean;
  /** Whether the turn was interrupted (user abort, error). */
  interrupted: boolean;
  /** Whether the session is in project mode (cwd is set) — when true, skill + memory review are skipped. */
  isProjectMode: boolean;
}

export interface TurnFinalizerOptions {
  /** Background review service (lazily resolved). */
  getReviewService: () => BackgroundReviewService | null;
  /** Number of turns between skill reviews (default 3). */
  skillReviewInterval?: number;
  /** Maximum turns before forcing a review (default 10). */
  forceReviewAfterTurns?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTextContent(msg: Message): string {
  if (!msg.content) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: unknown) => (b as { type?: string }).type === "text")
      .map((b: unknown) => (b as { text?: string }).text ?? "")
      .join(" ");
  }
  return "";
}

// ---------------------------------------------------------------------------
// TurnFinalizer
// ---------------------------------------------------------------------------

export class TurnFinalizer {
  private readonly options: TurnFinalizerOptions;
  private turnsSinceLastSkillReview = 0;
  private turnsSinceLastMemoryReview = 0;
  private pendingReview: Promise<void> | null = null;

  constructor(options: TurnFinalizerOptions) {
    this.options = options;
  }

  /**
   * Called after every turn completes. Decides whether to spawn a
   * background review. Never throws — errors are logged internally.
   */
  onTurnComplete(params: TurnCompleteParams): void {
    if (params.interrupted) {
      log("[TurnFinalizer] Turn was interrupted, skipping review");
      return;
    }

    this.turnsSinceLastSkillReview++;
    this.turnsSinceLastMemoryReview++;

    // Skill review: every N turns (if the model hasn't produced anything
    // worth learning, that's fine — the LLM decides).  Forced review
    // (forceReviewAfterTurns) is naturally covered because the counter
    // resets to 0 after every review, so the interval itself acts as the
    // upper bound.  This mirrors Hermes' _skill_nudge_interval.
    const interval = this.options.skillReviewInterval ?? 3;

    let shouldReviewSkills = this.turnsSinceLastSkillReview >= interval;

    // Gate: autoSkillLearning controls skill review + curator
    if (shouldReviewSkills && !configStore.getAll().autoSkillLearning) {
      this.turnsSinceLastSkillReview = 0;
      shouldReviewSkills = false;
    }

    // Gate: skip skill + memory review in project mode
    if (params.isProjectMode) {
      if (shouldReviewSkills) {
        log("[TurnFinalizer] Skipping skill review: project mode (cwd is set)");
        this.turnsSinceLastSkillReview = 0;
        shouldReviewSkills = false;
      }
      if (this.turnsSinceLastMemoryReview >= 2) {
        log(
          "[TurnFinalizer] Skipping memory review: project mode (cwd is set)",
        );
        this.turnsSinceLastMemoryReview = 0;
      }
    }

    // Memory review: every 2 turns (lighter weight)
    const shouldReviewMemory = this.turnsSinceLastMemoryReview >= 2;

    if (!shouldReviewSkills && !shouldReviewMemory) {
      return;
    }

    // Don't stack reviews — if one is pending, skip
    if (this.pendingReview) {
      log("[TurnFinalizer] Previous review still pending, skipping");
      return;
    }

    log(
      `[TurnFinalizer] Triggering review: skills=${shouldReviewSkills}, memory=${shouldReviewMemory}, ` +
        `turnsSinceSkill=${this.turnsSinceLastSkillReview}`,
    );

    const service = this.options.getReviewService();
    if (!service) {
      log("[TurnFinalizer] Review service not available");
      return;
    }

    // Reset counters
    if (shouldReviewSkills) this.turnsSinceLastSkillReview = 0;
    if (shouldReviewMemory) this.turnsSinceLastMemoryReview = 0;

    // Build snapshot from last turn's messages
    const snapshot = this.buildSnapshot(params.messages);

    // Fire-and-forget: don't await
    this.pendingReview = service
      .review(snapshot)
      .catch((err) => logError("[TurnFinalizer] Review failed:", err))
      .finally(() => {
        this.pendingReview = null;
      });
  }

  /**
   * Build a ReviewTurnSnapshot from the last turn's messages.
   * Takes the most recent user message + the assistant's response(s).
   */
  private buildSnapshot(messages: Message[]): ReviewTurnSnapshot {
    // Walk backward to find the last user→assistant turn
    const turnMessages: Array<{ role: string; content: string }> = [];
    let foundUser = false;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const content = extractTextContent(msg);
      if (!content) continue;

      if (msg.role === "assistant" || msg.role === "user") {
        // For user messages, preserve the tail (corrections tend to be at the end)
        const truncated =
          msg.role === "user" && content.length > 4000
            ? "…" + content.slice(-3996)
            : content.slice(0, 4000);
        turnMessages.unshift({ role: msg.role, content: truncated });
        if (msg.role === "user") foundUser = true;
      }

      // Capture up to 3 recent user→assistant turns so the review model
      // sees enough context to detect learning signals (e.g. user corrections
      // in the 2nd-last turn that the agent applied in the last turn).
      if (foundUser && msg.role === "user" && turnMessages.length >= 6) break;
      // Safety: don't capture more than 10 messages
      if (turnMessages.length >= 10) break;
    }

    return { messages: turnMessages };
  }
}
