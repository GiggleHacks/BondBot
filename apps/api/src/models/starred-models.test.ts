import { createRouterClient } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";

type Row = { userId: string; provider: string; modelId: string };

/** The starred_models table, keyed by all three columns. */
function setup() {
  const rows: Row[] = [];
  const matches = (row: Row, where: Partial<Row>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof Row] === value);
  const publishSpaceChange = vi.fn(async () => {});
  const starredModel = {
    findMany: async ({ where }: { where: Partial<Row> }) =>
      rows
        .filter((row) => matches(row, where))
        .map(({ provider, modelId }) => ({ provider, modelId })),
    createMany: async ({ data, skipDuplicates }: { data: Row; skipDuplicates?: boolean }) => {
      const duplicate = rows.some((row) => matches(row, data));
      if (duplicate && !skipDuplicates) throw new Error("unique violation");
      if (!duplicate) rows.push({ ...data });
      return { count: duplicate ? 0 : 1 };
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const kept = rows.filter((row) => !matches(row, where));
      const count = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { count };
    },
  };
  const deps = {
    prisma: { starredModel } as unknown as PrismaClient,
    events: { publishSpaceChange },
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/rakazo-router-test",
  } as unknown as RouterDeps;
  const client = (userId: string) =>
    createRouterClient(createRouter(deps), {
      context: {
        actor: {
          userId,
          spaceId: "space-1",
          email: `${userId}@rakazo.test`,
          isDeploymentOwner: false,
        } satisfies Actor,
      } as never,
    }).botModels;
  return { client, publishSpaceChange };
}

describe("starred models", () => {
  it("keeps each user's own stars, once each, and signals the change", async () => {
    const { client, publishSpaceChange } = setup();
    const alice = client("user-a");
    const bob = client("user-b");
    const model = { provider: "p", modelId: "m" };
    await alice.setStarred({ ...model, starred: true });
    await alice.setStarred({ ...model, starred: true });
    await expect(alice.starred()).resolves.toEqual([model]);
    await expect(bob.starred()).resolves.toEqual([]);
    expect(publishSpaceChange).toHaveBeenLastCalledWith("preferences:user-a", "preferences");

    await bob.setStarred({ ...model, starred: false });
    await expect(alice.starred()).resolves.toEqual([model]);
    await alice.setStarred({ ...model, starred: false });
    await expect(alice.starred()).resolves.toEqual([]);
  });
});
