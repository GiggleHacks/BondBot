// Local addition (BondBot): a 6-digit PIN may be the account's password. It is stored and checked
// as the password, so sign-in, change and reset are unchanged. Because a PIN is short, wrong ones
// are counted per email address across API processes, on top of the per-IP rate limits.
import { createHash } from "node:crypto";
import { isGuessablePin, isPin, MIN_PASSWORD_LENGTH } from "@rakazo/core";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

export const PIN_GUESSES = 5;
const GUESS_WINDOW_MS = 60 * 60_000;

/** Routes that set a new password, and the body field that carries it. */
const NEW_PASSWORD_FIELDS = new Map([
  ["/sign-up/email", "password"],
  ["/change-password", "newPassword"],
  ["/reset-password", "newPassword"],
  ["/set-password", "newPassword"],
]);

/** Counted whether or not the account exists, so a refusal does not reveal which addresses do. */
const guessKey = (email: string, slot: number) =>
  `pin-guess-${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}-${slot}`;

type Verification = { value: string; expiresAt: Date };
type GuessAdapter = {
  findVerificationValue(identifier: string): Promise<Verification | null>;
  consumeVerificationValue(identifier: string): Promise<Verification | null>;
  reserveVerificationValue(data: Verification & { identifier: string }): Promise<boolean>;
};

/**
 * Claims one of the address's PIN guesses before the PIN is checked; false when none are free.
 * Each guess is its own row created first-writer-wins, so parallel guesses cannot share one.
 */
export async function reservePinGuess(adapter: GuessAdapter, email: string): Promise<boolean> {
  for (let slot = 0; slot < PIN_GUESSES; slot += 1) {
    const identifier = guessKey(email, slot);
    const held = await adapter.findVerificationValue(identifier);
    if (held && held.expiresAt.getTime() <= Date.now())
      await adapter.consumeVerificationValue(identifier);
    const reserved = await adapter.reserveVerificationValue({
      identifier,
      value: "pin",
      expiresAt: new Date(Date.now() + GUESS_WINDOW_MS),
    });
    if (reserved) return true;
  }
  return false;
}

/** The email and password of a sign-in that tries a PIN, or null. */
function pinAttempt(body: unknown): { email: string } | null {
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  return typeof email === "string" && typeof password === "string" && isPin(password)
    ? { email }
    : null;
}

export function pinPassword() {
  return {
    id: "pin-password",
    hooks: {
      before: [
        {
          matcher: (ctx) => NEW_PASSWORD_FIELDS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const password: unknown = ctx.body?.[NEW_PASSWORD_FIELDS.get(ctx.path)!];
            if (typeof password !== "string") return;
            if (isPin(password)) {
              if (isGuessablePin(password)) {
                throw new APIError("BAD_REQUEST", {
                  code: "PIN_TOO_SIMPLE",
                  message: "That PIN is too easy to guess",
                });
              }
            } else if (password.length < MIN_PASSWORD_LENGTH) {
              throw new APIError("BAD_REQUEST", {
                code: "PASSWORD_TOO_SHORT",
                message: "Password too short",
              });
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const attempt = pinAttempt(ctx.body);
            if (!attempt) return;
            if (!(await reservePinGuess(ctx.context.internalAdapter, attempt.email))) {
              throw new APIError("TOO_MANY_REQUESTS", {
                code: "PIN_LOCKED",
                message: "Too many wrong PINs. Try again in an hour.",
              });
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            // A sign-in that worked gives the address its guesses back.
            const attempt = ctx.context.newSession ? pinAttempt(ctx.body) : null;
            if (!attempt) return;
            for (let slot = 0; slot < PIN_GUESSES; slot += 1)
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                guessKey(attempt.email, slot),
              );
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
