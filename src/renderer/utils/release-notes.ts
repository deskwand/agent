/**
 * The updater hands us the manifest's `releaseNotes` verbatim: a JSON string of
 * { zh, en } written by the release process, or null when the version predates
 * the feature. Everything unreadable collapses to null so the dialog only has
 * two cases to render — notes or no notes.
 */
export function pickReleaseNotes(
  raw: string | null | undefined,
  language: string,
): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const key = language.toLowerCase().startsWith("zh") ? "zh" : "en";
  const value = (parsed as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
