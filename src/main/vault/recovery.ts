import { randomBytes } from "node:crypto";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function generateRecoveryCode(): string {
  const bytes = randomBytes(24); // 192-bit entropy
  let code = "";
  for (const b of bytes) code += B58[b % B58.length];
  return code;
}

export function validateRecoveryCode(code: string): boolean {
  if (typeof code !== "string" || code.length < 24) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(code);
}
