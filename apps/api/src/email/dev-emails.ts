import type { EmailEmulator } from "@rakazo/adapters";
import type { Hono } from "hono";

/** Mail the local emulator caught, for a developer to read. */
export function mountDevEmails(app: Hono, emulator: Pick<EmailEmulator, "sent"> | undefined) {
  if (!emulator) return;
  app.get(
    "/api/dev/emails",
    () =>
      new Response(JSON.stringify(emulator.sent), {
        headers: { "cache-control": "no-store", "content-type": "application/json" },
      }),
  );
}
