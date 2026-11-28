import { expect, test } from "@playwright/test";
import { completeOnboarding, signup } from "../helpers/helpers";

// BondBot turns phone calls off in favour of voice notes.
test("an incoming call does not ring in the chat", async ({ page }) => {
  await signup(page, `incoming-call-${Date.now()}@rakazo.test`, "password12", "Caller");
  await completeOnboarding(page);
  let ringing = false;
  await page.route("**/rpc/spaces/list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const bot = body.json.current.bots[0];
    if (bot) {
      ringing = true;
      bot.incomingCall = {
        callId: "00000000-0000-4000-8000-000000000001",
        reason: "Review the report",
        opening: "Hello",
        expiresAt: new Date(Date.now() + 45000).toISOString(),
      };
    }
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect.poll(() => ringing).toBe(true);
  await expect(page.getByRole("combobox", { name: /Message/ })).toBeVisible();
  await expect(page.getByTestId("incoming-call")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
