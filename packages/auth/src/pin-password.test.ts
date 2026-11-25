import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./index.js";
import { PIN_GUESSES, reservePinGuess } from "./pin-password.js";

// Better Auth's real routes and hashing over its offline memory adapter. Guesses are reserved by
// inserting a row with a fixed id, so the adapter must refuse a second one as Postgres does.
vi.mock("better-auth/adapters/prisma", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  type Rows = Record<string, { id?: unknown }[]>;
  return {
    prismaAdapter: (prisma: { authData: Rows }) => {
      const create = memoryAdapter(prisma.authData);
      return (options: Parameters<typeof create>[0]) => {
        const adapter = create(options);
        return {
          ...adapter,
          create: async (input: Parameters<typeof adapter.create>[0]) => {
            const { id } = input.data as { id?: unknown };
            if (id && prisma.authData[input.model]?.some((row) => row.id === id))
              throw new Error("duplicate id");
            return adapter.create(input);
          },
        };
      };
    },
  };
});
vi.mock("@rakazo/db", () => ({
  bootstrapUserSpace: vi.fn(async () => ({ spaceId: "space-1" })),
  leaveInvitedSpaces: vi.fn(async () => ({ ownedOrganizationIds: [] })),
  recordSecurityEvent: vi.fn(async () => undefined),
}));

const baseURL = "http://auth.example.test";
const webOrigin = "http://web.example.test";
const email = "ada@example.test";
const pin = "294817";

function fixture() {
  const authData = { user: [], account: [], session: [], verification: [] };
  const prisma = {
    authData,
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        signupsEnabled: true,
        signupAllowlist: "",
        signupPolicyInitialized: true,
      })),
    },
    spaceMember: { findFirst: vi.fn(async () => ({ spaceId: "space-1" })) },
  };
  const auth = createAuth(prisma as never, {
    secret: "offline-auth-secret-at-least-32-characters",
    baseURL,
    webOrigin,
    signupsEnabled: "true",
    signupAllowlist: "",
  });
  const request = (path: string, body: unknown) =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify(body),
      }),
    );
  return {
    signUp: (password: string) => request("/sign-up/email", { email, password, name: "Ada" }),
    signIn: (password: string) => request("/sign-in/email", { email, password }),
  };
}

describe("PIN as the password", () => {
  it("signs up and signs in with a 6-digit PIN", async () => {
    const f = fixture();
    expect((await f.signUp(pin)).status).toBe(200);
    expect((await f.signIn(pin)).status).toBe(200);
  });

  it("refuses a PIN anyone would guess first", async () => {
    for (const easy of ["000000", "123456", "654321", "890123"]) {
      const response = await fixture().signUp(easy);
      expect(await response.json(), easy).toMatchObject({ code: "PIN_TOO_SIMPLE" });
    }
  });

  it("locks PIN sign-in after too many wrong PINs, however the digits are typed", async () => {
    const f = fixture();
    await f.signUp(pin);
    // Full-width digits hash like plain ones, so they must use up guesses too.
    for (let i = 0; i < PIN_GUESSES; i++) expect((await f.signIn("１１２２３３")).status).toBe(401);
    const locked = await f.signIn(pin);
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "PIN_LOCKED" });
  });

  it("gives the guesses back after a sign-in that works", async () => {
    const f = fixture();
    await f.signUp(pin);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < PIN_GUESSES - 1; i++) await f.signIn("111222");
      expect((await f.signIn(pin)).status).toBe(200);
    }
  });

  it("frees a guess once its window has passed", async () => {
    const rows = new Map<string, { value: string; expiresAt: Date }>();
    const adapter = {
      findVerificationValue: async (id: string) => rows.get(id) ?? null,
      consumeVerificationValue: async (id: string) => {
        rows.delete(id);
        return null;
      },
      reserveVerificationValue: async (row: {
        identifier: string;
        value: string;
        expiresAt: Date;
      }) => {
        if (rows.has(row.identifier)) return false;
        rows.set(row.identifier, row);
        return true;
      },
    };
    for (let i = 0; i < PIN_GUESSES; i++) await reservePinGuess(adapter, email);
    expect(await reservePinGuess(adapter, email)).toBe(false);
    for (const row of rows.values()) row.expiresAt = new Date(0);
    expect(await reservePinGuess(adapter, email)).toBe(true);
  });
});
