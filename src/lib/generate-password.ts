const CHARSET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*-";

/** Cryptographically random password (default 16 chars, min 8 for API validation). */
export function generatePassword(length = 16): string {
  const n = Math.max(8, length);
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join("");
}
