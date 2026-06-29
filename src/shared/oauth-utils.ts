/**
 * Shared OAuth utility functions usable by both main and renderer processes.
 */

/** Construct a profile key for an OAuth provider (e.g. "oauth:openai-codex"). */
export function oauthProfileKey(providerId: string): string {
  return `oauth:${providerId}`;
}

/** Extract the pi-ai provider ID from an OAuth profile key, or undefined if not an oauth key. */
export function extractOAuthProviderId(profileKey: string): string | undefined {
  if (profileKey.startsWith("oauth:")) {
    return profileKey.slice("oauth:".length);
  }
  return undefined;
}

/** Check whether a profile key is an OAuth profile key. */
export function isOAuthProfileKey(profileKey: string): boolean {
  return profileKey.startsWith("oauth:");
}
