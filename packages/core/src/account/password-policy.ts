/** Length limits for new passwords, with no composition rules (NIST SP 800-63B). */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// BondBot: a 6-digit PIN may stand in for a password (packages/auth pin-password).
export const PIN_LENGTH = 6;

/**
 * Whether `password` is a 6-digit PIN. Normalized the way the password hasher does it, so digits
 * typed another way (full-width, superscript) count as the PIN they verify against.
 */
export function isPin(password: string): boolean {
  return /^\d{6}$/.test(password.normalize("NFKC"));
}

/** A PIN anyone would try first: one digit repeated, or a straight run up or down. */
export function isGuessablePin(pin: string): boolean {
  const digits = [...pin.normalize("NFKC")].map(Number);
  const step = (digits[1] ?? 0) - (digits[0] ?? 0);
  if (Math.abs(step) > 1) return false;
  return digits.every((digit, i) => i === 0 || digit === ((digits[i - 1] ?? 0) + step + 10) % 10);
}

/** iOS AutoFill rules, so a generated password satisfies the server. */
export const PASSWORD_RULES = `minlength: ${MIN_PASSWORD_LENGTH}; maxlength: ${MAX_PASSWORD_LENGTH};`;
