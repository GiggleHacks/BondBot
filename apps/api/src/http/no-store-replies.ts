import type { Hono } from "hono";

/** Session and account replies must never be stored by a client or an HTTP cache. */
export function mountNoStoreReplies(app: Hono) {
  for (const path of ["/api/auth/*", "/rpc/*"]) {
    app.use(path, async (c, next) => {
      await next();
      c.header("cache-control", "no-store");
    });
  }
}
