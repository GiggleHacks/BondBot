import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  createNamedBot,
  openBotPanel,
  rpc,
  signup,
} from "../helpers/helpers";

test("Multiview resizes its chats and offers chat columns without reloading screens", async ({
  page,
}, testInfo) => {
  await signup(page, `multiview-${Date.now()}@rakazo.test`, "password12", "Multi View");
  await completeOnboarding(page);
  const chiefId = activeBotId(page);
  await createNamedBot(page, "Scout", { computerMode: "dedicated" });
  await rpc(page, "computer/boot", { botId: chiefId });
  await page.goto(`/app/${chiefId}`);

  // A sleeping bot is marked in the sidebar; one with its computer on is not.
  const rows = page.getByTestId("bots-sidebar");
  await expect(rows.locator("[data-roster-bot-id]").filter({ hasText: "Scout" })).toContainText(
    "Scout",
  );
  await expect(rows.getByTestId("bot-asleep")).toHaveCount(1);

  // The bot panel reads the running computer's usage faintly under the name.
  await openBotPanel(page);
  await expect(page.getByTestId("bot-usage")).toHaveText("RAM1.2 GBCPU8%");
  await captureScreenshot(page, testInfo, "bot-panel-usage-and-sleeping-bot");
  await page.getByTestId("bot-settings-trigger").click();

  await page.getByTestId("multiview-toggle").click();
  const workspace = page.getByTestId("multiview-workspace");
  const screen = workspace.getByTestId(`multiview-screen-${chiefId}`);
  const frame = screen.locator("iframe");
  await expect(frame).toBeVisible({ timeout: 30_000 });
  await frame.evaluate((node) => node.setAttribute("data-same-frame", "yes"));
  await captureScreenshot(page, testInfo, "multiview-screens");

  const height = async () => (await screen.boundingBox())!.height;
  const before = await height();
  const divider = workspace.getByTestId(`multiview-divider-${chiefId}`);
  await divider.hover();
  await page.mouse.wheel(0, -200);
  await expect.poll(height).toBeLessThan(before - 100);

  const grip = divider.getByRole("separator");
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 600, { steps: 8 });
  await page.mouse.up();
  // The screen keeps a usable height however far the divider is pulled.
  await expect.poll(height).toBeLessThan(120);
  expect(await height()).toBeGreaterThanOrEqual(96);
  await expect(workspace.getByRole("textbox", { name: "Message Chief" })).toBeInViewport();
  await captureScreenshot(page, testInfo, "multiview-screens-chat-tall");

  await workspace.getByRole("button", { name: "Large chats" }).click();
  await expect(frame).toHaveAttribute("data-same-frame", "yes");
  const small = (await screen.boundingBox())!;
  const tile = (await workspace.getByTestId(`multiview-tile-${chiefId}`).boundingBox())!;
  expect(small.width).toBeLessThan(tile.width / 2);
  expect(tile.x + tile.width - (small.x + small.width)).toBeLessThan(20);
  await expect(workspace.getByRole("separator")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "multiview-chats");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(screen).toBeVisible();
  await captureScreenshot(page, testInfo, "multiview-chats-phone");
});
