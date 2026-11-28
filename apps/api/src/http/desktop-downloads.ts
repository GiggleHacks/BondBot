import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";

const BUILDS = [
  {
    route: "/api/desktop/windows",
    file: "BondBot.exe",
    label: "Windows",
    contentType: "application/vnd.microsoft.portable-executable",
  },
  {
    route: "/api/desktop/mac",
    file: "BondBot.dmg",
    label: "macOS",
    contentType: "application/x-apple-diskimage",
  },
];

/** Serves the desktop builds the operator put in `<dataDir>/downloads`. HEAD says whether one is there. */
export function mountDesktopDownloadRoutes(
  app: Hono,
  dataDir: string,
  sessionActor: (request: Request) => Promise<unknown>,
) {
  for (const build of BUILDS) {
    app.get(build.route, async (c) => {
      if (!(await sessionActor(c.req.raw))) return c.json({ error: "Unauthorized" }, 401);
      const file = path.join(dataDir, "downloads", build.file);
      const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!info?.isFile()) {
        return c.json({ error: `${build.label} desktop build is not available yet.` }, 404);
      }
      const body =
        c.req.raw.method === "HEAD"
          ? null
          : (Readable.toWeb(createReadStream(file)) as ReadableStream);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": build.contentType,
          "content-disposition": `attachment; filename="${build.file}"`,
          "content-length": String(info.size),
          "cache-control": "no-store",
        },
      });
    });
  }
}
