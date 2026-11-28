import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { bestEffort } from "@rakazo/logging";
import { selectOrphanDirs } from "../voice-note-guards.js";

/** Folders left by notes that no longer exist (or were sent), such as after a crash. */
export async function sweepOrphanDirs(prisma: PrismaClient, dataDir: string, graceMs: number) {
  const root = path.join(dataDir, "voice-notes");
  // No folder until the first note is recorded.
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const dirs: Array<{ name: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const info = await bestEffort("read a voice note folder", stat(path.join(root, entry.name)));
    if (info) dirs.push({ name: entry.name, mtimeMs: info.mtimeMs });
  }
  for (let at = 0; at < dirs.length; at += 500) {
    const batch = dirs.slice(at, at + 500);
    const rows = await runAsSystem("voice note: find folders without a note", () =>
      prisma.voiceNote.findMany({
        where: { id: { in: batch.map((dir) => dir.name) } },
        select: { id: true, status: true },
      }),
    );
    for (const name of selectOrphanDirs(batch, rows, Date.now(), graceMs)) {
      await rm(path.join(root, name), { recursive: true, force: true });
    }
  }
}
