export type SessionKind = "ordinary" | "voice" | "agent";

export function normalizeSessionKind(value: unknown): SessionKind {
  return value === "voice" || value === "agent" ? value : "ordinary";
}
