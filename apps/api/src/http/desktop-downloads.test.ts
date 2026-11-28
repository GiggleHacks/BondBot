import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";
import { mountDesktopDownloadRoutes } from "./desktop-downloads.js";

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "desktop-downloads-"));
  await mkdir(path.join(dataDir, "downloads"));
});
afterEach(() => rm(dataDir, { recursive: true, force: true }));

function server(signedIn = true) {
  const app = new Hono();
  mountDesktopDownloadRoutes(app, dataDir, async () => (signedIn ? {} : null));
  return app;
}

it("answers 404 for a build the operator has not added", async () => {
  const response = await server().request("/api/desktop/mac", { method: "HEAD" });
  expect(response.status).toBe(404);
});

it("reports an added build on HEAD and serves it on GET", async () => {
  await writeFile(path.join(dataDir, "downloads", "BondBot.dmg"), "disk image");
  const head = await server().request("/api/desktop/mac", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe("10");
  const get = await server().request("/api/desktop/mac");
  expect(get.headers.get("content-disposition")).toBe('attachment; filename="BondBot.dmg"');
  expect(await get.text()).toBe("disk image");
});

it("refuses a signed-out caller", async () => {
  const response = await server(false).request("/api/desktop/windows");
  expect(response.status).toBe(401);
});
