/**
 * Prompt smoke test — validates background review + curator prompt content
 * without requiring an LLM.  With the AgentRunner fork architecture there is
 * no YAML parsing — the LLM uses tools directly.
 */

import { describe, expect, it } from "vitest";
import { BACKGROUND_REVIEW_SYSTEM_PROMPT } from "../src/main/agent/review-prompts";
import { CURATOR_SYSTEM_PROMPT } from "../src/main/agent/curator-prompts";

// ============================================================================
// Scenario 1: Prompt completeness — key phrases MUST exist
// ============================================================================
describe("review prompts — key phrases", () => {
  const reviewPhrases = [
    "UPDATE CURRENTLY-LOADED SKILL",
    "UPDATE EXISTING UMBRELLA",
    "ADD REFERENCE FILE",
    "CREATE NEW SKILL",
    "FIRST-CLASS",
    "memory_upsert",
    "memory_delete",
    "Tools available",
    "read",
    "skill_create",
    "skill_patch",
    "skill_add_reference",
    "Signals you MUST IGNORE",
  ];

  const curatorPhrases = [
    "MERGE INTO EXISTING UMBRELLA",
    "CREATE NEW UMBRELLA",
    "DEMOTE TO REFERENCES",
    "Fewer than 10 actions",
    "DO NOT touch",
    "CLASS-LEVEL",
    "ABSENCE OF EVIDENCE",
    "evicted from the main directory",
    "How to work",
  ];

  for (const phrase of reviewPhrases) {
    it(`BACKGROUND_REVIEW contains: "${phrase}"`, () => {
      expect(BACKGROUND_REVIEW_SYSTEM_PROMPT).toContain(phrase);
    });
  }

  for (const phrase of curatorPhrases) {
    it(`CURATOR contains: "${phrase}"`, () => {
      expect(CURATOR_SYSTEM_PROMPT).toContain(phrase);
    });
  }

  it("all prompts are non-empty", () => {
    expect(BACKGROUND_REVIEW_SYSTEM_PROMPT.length).toBeGreaterThan(500);
    expect(CURATOR_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });
});

// ============================================================================
// Scenario 2: Prompt construction with sample data (print for manual review)
// ============================================================================
describe("prompt construction — manual review samples", () => {
  it("prints BACKGROUND_REVIEW prompt with a correction scenario", () => {
    const turnMessages = [
      {
        role: "user",
        content: "不对，你应该用 grep 而不是 read 来找代码。read 太慢了，我只要搜索结果。下次注意。",
      },
      {
        role: "assistant",
        content: "明白了，下次我会优先用 grep 做代码搜索，只在需要看完整文件内容时才用 read。已记下这个偏好。",
      },
    ];

    const turnText = turnMessages.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
    const fullPrompt = `=== SYSTEM ===\n${BACKGROUND_REVIEW_SYSTEM_PROMPT}\n\n=== USER ===\nReview this conversation turn and decide if any skills or memory entries should be created or updated.\n\n## Conversation\n\n${turnText}\n\nStart by using read to check what skills already exist before creating or patching.`;

    console.log("\n📋 Scenario 2a: User corrects tool choice\n");
    console.log(fullPrompt);
    console.log("\n--- end of prompt ---\n");

    expect(fullPrompt).toContain("grep");
    expect(fullPrompt).toContain("read");
    expect(fullPrompt).toContain("FIRST-CLASS");
  });

  it("prints BACKGROUND_REVIEW prompt with a memory-only scenario", () => {
    const turnMessages = [
      { role: "user", content: "帮我查一下这个 PDF。记住我以后都要简洁的输出，不要废话。" },
      { role: "assistant", content: "好的。PDF 内容已提取：共 3 页，包含财务数据表格。" },
    ];

    const turnText = turnMessages.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
    const fullPrompt = `=== SYSTEM ===\n${BACKGROUND_REVIEW_SYSTEM_PROMPT}\n\n=== USER ===\nReview this conversation turn and decide if any skills or memory entries should be created or updated.\n\n## Conversation\n\n${turnText}\n\nStart by using read to check what skills already exist before creating or patching.`;

    console.log("\n📋 Scenario 2b: User wants concise output\n");
    console.log(fullPrompt);
    console.log("\n--- end of prompt ---\n");

    expect(fullPrompt).toContain("简洁");
    expect(fullPrompt).toContain("不要废话");
  });

  it("prints CURATOR prompt with skill candidates", () => {
    const candidates = [
      { name: "pdf-extract", description: "Extract text from PDF files", usageStr: "used 15x, last: 2026-06-01, status: active" },
      { name: "pdf-ocr", description: "OCR scanned PDFs to extract text", usageStr: "used 8x, last: 2026-05-28, status: active" },
      { name: "pdf-merge", description: "Merge multiple PDFs into one", usageStr: "used 3x, last: 2026-05-15, status: active" },
      { name: "old-xml-parser", description: "Parse legacy XML configs", usageStr: "used 1x, last: 2026-02-10, status: stale" },
      { name: "abandoned-csv", description: "Quick CSV preview", usageStr: "used 0x, last: 2026-01-05, status: stale" },
    ];

    const candidateLines = candidates.map((c) => `- ${c.name}: ${c.description} (${c.usageStr})`);
    const userPrompt = `## Skills to curate\n\n${candidateLines.join("\n")}\n\nReview these agent-created skills. Read their SKILL.md files, identify clusters, and use your tools to consolidate them into class-level umbrella skills. Archive skills that are stale (90+ days unused).\n\nBe thorough — fewer than 10 actions means you stopped too early.`;

    const fullPrompt = `=== SYSTEM ===\n${CURATOR_SYSTEM_PROMPT}\n\n=== USER ===\n${userPrompt}`;

    console.log("\n📋 Scenario 2c: Curator with 5 agent-created skills\n");
    console.log(fullPrompt);
    console.log("\n--- end of prompt ---\n");

    expect(fullPrompt).toContain("pdf-extract");
    expect(fullPrompt).toContain("pdf-ocr");
    expect(fullPrompt).toContain("pdf-merge");
    expect(fullPrompt).toContain("abandoned-csv");
    expect(fullPrompt).toContain("MERGE INTO EXISTING UMBRELLA");
    expect(fullPrompt).toContain("CREATE NEW UMBRELLA");
  });

  it("prints BACKGROUND_REVIEW standalone prompt", () => {
    console.log("\n📋 Scenario 2d: BACKGROUND_REVIEW standalone\n");
    console.log("=== BACKGROUND_REVIEW_SYSTEM_PROMPT ===");
    console.log(BACKGROUND_REVIEW_SYSTEM_PROMPT);
    console.log("\n--- end of prompt ---\n");

    expect(BACKGROUND_REVIEW_SYSTEM_PROMPT).toContain("skill_create");
    expect(BACKGROUND_REVIEW_SYSTEM_PROMPT).toContain("skill_patch");
    expect(BACKGROUND_REVIEW_SYSTEM_PROMPT).toContain("skill_add_reference");
    expect(BACKGROUND_REVIEW_SYSTEM_PROMPT).toContain("memory_upsert");
    expect(BACKGROUND_REVIEW_SYSTEM_PROMPT).toContain("memory_delete");
  });
});

// ============================================================================
// Scenario 3: Edge cases
// ============================================================================
describe("prompt edge cases", () => {
  it("BACKGROUND_REVIEW prompt mentions available tools", () => {
    expect(BACKGROUND_REVIEW_SYSTEM_PROMPT).toMatch(/skill_create|skill_patch|skill_add_reference/);
    expect(BACKGROUND_REVIEW_SYSTEM_PROMPT).toMatch(/memory_upsert|memory_delete/);
  });

  it("CURATOR prompt instructs tool-based workflow", () => {
    expect(CURATOR_SYSTEM_PROMPT).toContain("How to work");
    expect(CURATOR_SYSTEM_PROMPT).toContain("read");
    expect(CURATOR_SYSTEM_PROMPT).toContain("DO NOT");
  });
});

// ============================================================================
// Scenario 4: Data flow — truncation logic
// ============================================================================
describe("prompt data flow", () => {
  it("user message tail preserved when >4000 chars", () => {
    const longMessage = "a".repeat(3000) + " IMPORTANT CORRECTION: always use grep not read " + "z".repeat(2000);
    const truncated = longMessage.length > 4000 ? "…" + longMessage.slice(-3996) : longMessage.slice(0, 4000);
    expect(truncated).toContain("IMPORTANT CORRECTION");
    expect(truncated).toContain("grep not read");
    expect(truncated.startsWith("…")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(4000);
  });

  it("assistant message head preserved when >4000 chars", () => {
    const longMessage = "RESULT: " + "x".repeat(5000);
    const truncated = longMessage.length > 4000 ? longMessage.slice(0, 4000) : longMessage;
    expect(truncated.startsWith("RESULT:")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(4000);
  });
});
