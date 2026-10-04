export type SessionKind = "ordinary" | "voice";

export function normalizeSessionKind(value: unknown): SessionKind {
  return value === "voice" ? "voice" : "ordinary";
}
