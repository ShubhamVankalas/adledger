import { readFileSync } from "node:fs";
import path from "node:path";

// Password rules from NIST SP 800-63B-4 (§3.1.1.2):
// - at least 15 characters when the password is the only factor, 8 when 2FA is also on;
// - no composition rules ("one symbol, one digit…") and no forced periodic changes;
// - refuse common, expected or context-specific values (a blocklist, repeats, sequences, the
//   person's own email or name, the product name);
// - allow long passphrases (200 characters) and any Unicode, compared after NFKC normalisation.

export const MIN_LENGTH_SINGLE_FACTOR = 15;
export const MIN_LENGTH_WITH_2FA = 8;
export const MAX_LENGTH = 200;

const FALLBACK = ["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwertyuiop", "iloveyou", "adledger"];
let blocklist: Set<string> | undefined;

/** The shipped blocklist (src/lib/security/common-passwords.txt), loaded once. */
export function commonPasswords(): Set<string> {
  if (blocklist) return blocklist;
  let lines = FALLBACK;
  try {
    const file = readFileSync(path.join(process.cwd(), "src/lib/security/common-passwords.txt"), "utf8");
    lines = file.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  } catch {
    // Missing from an unusual build: the length and pattern rules still apply.
  }
  blocklist = new Set(lines.map((l) => l.trim().toLowerCase()).filter(Boolean));
  return blocklist;
}

/** The password is one character repeated, or a short chunk repeated ("abcabcabc…"). */
function isRepetitive(pw: string): boolean {
  for (let size = 1; size <= 4; size++) {
    const chunk = pw.slice(0, size);
    if (pw.length >= size * 3 && chunk.repeat(Math.ceil(pw.length / size)).slice(0, pw.length) === pw) return true;
  }
  return false;
}

/** Runs straight up or down an alphabet or keyboard row ("123456789…", "abcdefgh…", "qwertyuiop"). */
function isSequential(pw: string): boolean {
  const rows = ["0123456789012345678901234567890", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm", "1qaz2wsx3edc4rfv5tgb6yhn7ujm"];
  const lower = pw.toLowerCase();
  return rows.some((r) => r.includes(lower) || [...r].reverse().join("").includes(lower));
}

export type PasswordContext = { has2fa?: boolean; email?: string | null; name?: string | null };

/** A human-readable reason the password is refused, or null when it's fine. */
export function passwordProblem(password: string, ctx: PasswordContext = {}): string | null {
  const pw = password.normalize("NFKC");
  const min = ctx.has2fa ? MIN_LENGTH_WITH_2FA : MIN_LENGTH_SINGLE_FACTOR;
  // Count characters, not UTF-16 units, so emoji and Devanagari count the way people expect.
  const length = [...pw].length;
  if (length < min) {
    return ctx.has2fa ? `Use at least ${min} characters.` : `Use at least ${min} characters. A short sentence works well. (With two-factor sign-in on, ${MIN_LENGTH_WITH_2FA} is enough.)`;
  }
  if (length > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters.`;
  const lower = pw.toLowerCase();
  const squashed = lower.replace(/\s+/g, "");
  if (commonPasswords().has(lower) || commonPasswords().has(squashed)) return "That password is on a list of commonly used passwords. Choose something less predictable.";
  if (isRepetitive(squashed) || isSequential(squashed)) return "Avoid repeated or sequential characters. Choose something less predictable.";
  const email = ctx.email?.trim().toLowerCase();
  const local = email?.split("@")[0];
  if (email && (squashed === email || (local && local.length >= 4 && squashed.replace(/\d+$/, "") === local))) return "Don't use your email address as your password.";
  const name = ctx.name?.trim().toLowerCase().replace(/\s+/g, "");
  if (name && name.length >= 4 && squashed.replace(/\d+$/, "") === name) return "Don't use your name as your password.";
  return null;
}

/** The minimum length that applies, for form hints. */
export const minPasswordLength = (has2fa = false) => (has2fa ? MIN_LENGTH_WITH_2FA : MIN_LENGTH_SINGLE_FACTOR);
