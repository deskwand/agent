import { AGENT_TOOL_NAME } from "../agent/subagent/agent-name-hook";
import type { PersistentAgent } from "../../shared/persistent-agent";
import { riskyCapabilityOf } from "../../shared/agent-risky-capabilities";

export type GuardDecision =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | {
      action: "ask";
      recipients: string[];
      hasAttachments: boolean;
      preview: string;
    };

type GuardAgent = Pick<
  PersistentAgent,
  "instructions" | "trustedRecipients" | "riskyCapabilities"
>;

const OUTBOUND_VERBS = new Set([
  "send",
  "post",
  "reply",
  "respond",
  "forward",
  "share",
  "invite",
  "publish",
]);

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^[A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/m,
];

const GENERIC_RECIPIENT_KEYS = [
  "to",
  "cc",
  "bcc",
  "recipient",
  "recipients",
  "channel",
  "channel_id",
  "chat_id",
  "user",
  "user_id",
  "email",
];

const UNKNOWN_RECIPIENT = "(unknown recipient)";

/** pi-subagents' workflow tool spawns the same (bash-capable) subagents as `Agent`. */
const SUBAGENT_WORKFLOW_TOOL_NAME = "SubagentWorkflow";

function lastSegment(toolName: string): string {
  const parts = toolName.split("__");
  return parts[parts.length - 1];
}

function isEmailTool(toolName: string, kind: "email_send" | "email_respond") {
  return toolName === kind || lastSegment(toolName) === kind;
}

function isOutboundTool(toolName: string): boolean {
  if (
    isEmailTool(toolName, "email_send") ||
    isEmailTool(toolName, "email_respond")
  ) {
    return true;
  }
  if (!toolName.startsWith("mcp__")) return false;
  const tokens = lastSegment(toolName)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_-]+/);
  if (tokens.some((token) => OUTBOUND_VERBS.has(token))) return true;
  // Noun-style IM tools (`im_v1_message_create`): "message" only counts with a create/new token.
  return (
    tokens.includes("message") &&
    (tokens.includes("create") || tokens.includes("new"))
  );
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectStrings(v, out));
  }
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function hasNonEmpty(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function previewOf(input: Record<string, unknown>): string {
  for (const key of ["body", "text", "message", "content"]) {
    const v = input[key];
    if (typeof v === "string") return v.slice(0, 200);
  }
  return "";
}

const EMAIL_PATTERN = /[^\s<>,;"'()[\]]+@[^\s<>,;"'()[\]]+/g;

/**
 * One recipient string may hold several addresses ("Boss <boss@co>, evil@x");
 * every email address is extracted. A value without any email (IM ids, channels)
 * is used whole, trimmed and lower-cased; blank values yield nothing.
 */
export function extractRecipients(raw: string): string[] {
  const emails = raw.toLowerCase().match(EMAIL_PATTERN);
  if (emails) return emails.map((e) => e.replace(/[.]+$/, ""));
  const whole = raw.trim().toLowerCase();
  return whole ? [whole] : [];
}

/** "Bob <BOB@x.com>" → "bob@x.com"；其余 trim + 小写（多地址时取第一个）。 */
export function normalizeRecipient(raw: string): string {
  return extractRecipients(raw)[0] ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `recipient` appears in `text` on a token boundary (not inside a longer address/word). */
function isMentioned(text: string, recipient: string): boolean {
  return new RegExp(
    `(?<![\\w.+@-])${escapeRegExp(recipient)}(?![\\w@-]|\\.\\w)`,
  ).test(text);
}

export function evaluateToolCall(
  toolName: string,
  input: Record<string, unknown>,
  agent: GuardAgent,
): GuardDecision {
  const cap = riskyCapabilityOf(toolName);
  if (cap && agent.riskyCapabilities[cap] === false) {
    return {
      action: "block",
      reason: `Blocked: this teammate does not have the ${cap} capability enabled. Do not try another tool to get around this; tell the user in your report if you need it.`,
    };
  }
  if (
    (toolName === AGENT_TOOL_NAME ||
      toolName.toLowerCase() === SUBAGENT_WORKFLOW_TOOL_NAME.toLowerCase()) &&
    agent.riskyCapabilities.shell === false
  ) {
    return {
      action: "block",
      reason:
        "Blocked: subagents are unavailable because this teammate does not have the shell capability enabled.",
    };
  }

  if (!isOutboundTool(toolName)) return { action: "allow" };

  const strings: string[] = [];
  collectStrings(input, strings);
  const text = strings.join("\n");
  if (SECRET_PATTERNS.some((re) => re.test(text))) {
    return {
      action: "block",
      reason:
        "Blocked: the content looks like it contains a secret (API key, token or private key). Never send secrets.",
    };
  }

  let rawRecipients: string[];
  let hasAttachments = false;
  if (isEmailTool(toolName, "email_send")) {
    rawRecipients = ["to", "cc", "bcc"].flatMap((k) => stringValues(input[k]));
    hasAttachments = hasNonEmpty(input.attachments);
  } else if (isEmailTool(toolName, "email_respond")) {
    rawRecipients = stringValues(input.to);
    // A forward re-sends the original attachments unless explicitly turned off;
    // a reply only goes back to the original sender, so it needs an explicit opt-in.
    const includesOriginal =
      input.response_type === "forward"
        ? input.include_attachments !== false
        : input.include_attachments === true;
    hasAttachments =
      includesOriginal || hasNonEmpty(input.additional_attachments);
  } else {
    rawRecipients = GENERIC_RECIPIENT_KEYS.flatMap((k) =>
      stringValues(input[k]),
    );
    // Decided after extraction: blank values must not hide an unlisted real target.
    if (rawRecipients.flatMap(extractRecipients).length === 0) {
      rawRecipients = [UNKNOWN_RECIPIENT];
    }
  }

  const instructions = agent.instructions.toLowerCase();
  const trusted = new Set(agent.trustedRecipients.flatMap(extractRecipients));
  const unknown = [
    ...new Set(
      rawRecipients
        .flatMap(extractRecipients)
        .filter((r) => !trusted.has(r) && !isMentioned(instructions, r)),
    ),
  ];

  if (unknown.length === 0 && !hasAttachments) return { action: "allow" };
  return {
    action: "ask",
    recipients: unknown,
    hasAttachments,
    preview: previewOf(input),
  };
}
