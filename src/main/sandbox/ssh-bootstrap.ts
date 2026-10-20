export function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildAuthorizedKeysCommand(publicKey: string): string {
  const key = shQuote(publicKey);
  return [
    "umask 077",
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh",
    "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys",
    `(grep -qxF ${key} ~/.ssh/authorized_keys || printf '%s\\n' ${key} >> ~/.ssh/authorized_keys)`,
  ].join(" && ");
}
