import type { Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  openUserSettings,
  signup,
} from "../helpers/helpers";

type Snapshot = {
  messages?: Array<Record<string, unknown> & { seq: number; blocks: unknown[] }>;
};

const availability = {
  canManage: true,
  mode: "sidecar",
  canApply: true,
  currentUiVersion: "0.5.0",
  currentApiVersion: "1.10.0",
  currentCommit: null,
  latestUiVersion: "0.5.1",
  latestApiVersion: "1.10.1",
  latestCommit: null,
  updateAvailable: true,
  changelogSummary: null,
  repoUrl: "https://github.com/GiggleHacks/BondBot",
  branch: "main",
  checkedAt: null,
  checkError: null,
  manualCommands: [],
};

function job(patch: Record<string, unknown>) {
  return {
    jobId: "job-1",
    running: true,
    phase: "downloading",
    progress: 12,
    message: "Downloading latest BondBot code from GitHub...",
    targetUiVersion: "0.5.1",
    targetApiVersion: "1.10.1",
    targetCommit: null,
    startedAt: new Date(Date.now() - 36_000).toISOString(),
    finishedAt: null,
    error: null,
    restartRequired: false,
    logTail: null,
    ...patch,
  };
}

test("an update is offered above the footer and shows each step as it happens", async ({
  page,
}, testInfo) => {
  let current = job({ phase: "idle", running: false });
  await page.route("**/rpc/bondbotUpdate/status", (route) =>
    route.fulfill({ json: { json: availability } }),
  );
  await page.route("**/rpc/bondbotUpdate/progress", (route) =>
    route.fulfill({ json: { json: current } }),
  );
  await page.route("**/rpc/bondbotUpdate/apply", (route) => {
    current = job({
      detail: "Receiving files",
      downloadedBytes: 12_500_000,
      bytesPerSecond: 4_100_000,
    });
    return route.fulfill({ json: { json: current } });
  });
  await signup(page, `update-card-${Date.now()}@rakazo.test`, "password12", "Updates");
  await completeOnboarding(page);

  const card = page.getByTestId("bondbot-update-card");
  const update = card.getByRole("button", { name: "Update to v0.5.1" });
  await expect(update).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const footerBox = (await page.getByTestId("sidebar-footer").boundingBox())!;
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(footerBox.y);
  await captureScreenshot(page, testInfo, "update-offered");

  await update.click();
  await expect(card.getByTestId("bondbot-update-speed")).toHaveText(
    "12.5 MB downloaded at 4.1 MB/s",
  );
  await captureScreenshot(page, testInfo, "update-downloading");

  current = job({
    phase: "building",
    progress: 54,
    detail: "deps 3/7: RUN pnpm install --frozen-lockfile",
    etaSeconds: 200,
  });
  await expect(card.locator('li[data-state="active"]')).toContainText("Build BondBot");
  await expect(card).toContainText("About 3 minutes left");
  await expect(card).toContainText("Safe to refresh or close this page.");
  await card.locator("summary").first().click();
  await expect(card).toContainText("pnpm install");
  await captureScreenshot(page, testInfo, "update-building");

  // A refresh part way through carries on where the update is.
  await page.reload();
  await expect(card.locator('li[data-state="active"]')).toContainText("Build BondBot");

  current = job({ running: false, phase: "idle", progress: 0 });
  await page.reload();
  await card.getByRole("button", { name: "Skip" }).click();
  await expect(card).toHaveCount(0);

  const settings = await openUserSettings(page);
  await settings.getByTestId("chat-sound-thinking").scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, "settings-sounds");
});

test("colour and the chosen font are off until chosen, and survive a reload", async ({
  page,
}, testInfo) => {
  await signup(page, `chat-style-${Date.now()}@rakazo.test`, "password12", "Style");
  await completeOnboarding(page);
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-chat-colors", "on");
  await expect(html).not.toHaveAttribute("data-font");

  const settings = await openUserSettings(page);
  await settings.getByTestId("colorful-chat-toggle").click();
  await settings.getByTestId("app-font-select").click();
  await page.getByRole("option", { name: "Mono", exact: true }).click();
  await page.evaluate(() => {
    localStorage.setItem("rakazo.uiAppearance", "dark-blue");
    // Tool steps are listed only with this on.
    localStorage.setItem("rakazo.showToolActivity", "on");
  });
  await page.reload();
  await expect(html).toHaveAttribute("data-chat-colors", "on");
  await expect(html).toHaveAttribute("data-font", "mono");
  const reopened = page.getByTestId("user-settings");
  await reopened.getByRole("button", { name: /close/i }).click();
  await expect(reopened).toHaveCount(0);

  await page.getByPlaceholder(/Message/).fill("hello");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("message-user-bubble").first()).toBeVisible();
  // A reply with every kind of part, drawn into the chat's own history.
  const addSample = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Snapshot & { thread?: Snapshot } };
    const snapshot = body.json.thread ?? body.json;
    const last = snapshot.messages?.at(-1);
    if (!last) return route.fulfill({ response });
    snapshot.messages!.push({
      ...last,
      id: "colour-sample",
      seq: last.seq + 1,
      role: "bot",
      blocks: [
        { kind: "reasoning", reasoning: "Check the inbox first, then run the backup." },
        {
          kind: "steps",
          steps: [
            { label: "Bash", count: 2 },
            { label: "Web search", count: 1 },
            { label: "Read file", count: 1 },
            { label: "Computer use", count: 1, outcomes: { failed: 1 } },
          ],
        },
        {
          kind: "text",
          text: "## Backup report\n\n**Important:** one disk is nearly full.\n\n- Copied `notes.txt`\n- See [the log](https://example.test/log)\n\n> Free some space before tonight.",
        },
      ],
    });
    await route.fulfill({ response, json: body });
  };
  // The first load brings the chat in the bootstrap; later reads ask for the thread.
  await page.route("**/rpc/bootstrap", addSample);
  await page.route("**/rpc/threads/get", addSample);
  await page.reload();
  await expect(page.getByText("Backup report")).toBeVisible();
  await page.getByTestId("tool-activity").last().locator("button").first().click();
  await expect(page.locator('[data-tool-kind="shell"]')).toBeVisible();
  await expect(page.locator("[data-tool-failed]")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("font-family", /JetBrains Mono/);
  await captureScreenshot(page, testInfo, "chat-colours-mono-font");
});
