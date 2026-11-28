import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "../helpers/helpers";

// BondBot turns phone calls and read-aloud off in favour of voice notes.
test("a connected voice adds no call button and no read-aloud", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `calls-off-${stamp}@rakazo.test`, "password12", "Calls Off");
  await completeOnboarding(page);

  // A scripted reply gives the message menu something to act on.
  const composer = page.getByRole("combobox", { name: /Message/ });
  await composer.fill(`calls-off-${stamp}`);
  await composer.press("Enter");
  const replyText = `i handled: calls-off-${stamp}`;
  await expect(page.getByTestId("message-bot-bubble").filter({ hasText: replyText })).toBeVisible({
    timeout: 20_000,
  });

  await rpc(page, "voice/connect", { provider: "scripted", apiKey: "fake-call-voice-key" });
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  // After the reload only the durable reply is on screen, so the locator is unambiguous.
  const message = page
    .locator("[data-message-id]")
    .filter({ has: page.getByTestId("message-bot-bubble").filter({ hasText: replyText }) })
    .last();
  await message.hover();
  await message.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Read aloud" })).toHaveCount(0);
  await expect(page.getByTestId("chat-header")).toBeVisible();
  await expect(page.getByTestId("call-button")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "chat-without-calls");
});
