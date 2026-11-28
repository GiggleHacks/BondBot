import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, chooseOption, completeOnboarding, signup } from "../helpers/helpers";

test("Voice offers subscription sign-in and reveals the API-key field on request", async ({
  page,
}, testInfo) => {
  await signup(page, `voice-sign-in-${Date.now()}@rakazo.test`, "password12", "Voice Preview");
  await completeOnboarding(page);
  await openVoiceSettings(page);
  const voice = page.getByTestId("voice-settings");
  await chooseOption(voice.getByRole("combobox", { name: "Provider" }), "xAI");
  await expect(voice.getByRole("button", { name: /^Sign in with / })).toBeVisible();
  const key = voice.getByLabel("API key", { exact: true });
  const revealKey = voice.getByRole("button", { name: "Or paste an API key" });
  await expect(revealKey).toBeVisible();
  await expect(key).toHaveCount(0);
  await captureScreenshot(page, testInfo, "voice-subscription-sign-in");
  await revealKey.click();
  await expect(key).toBeFocused();
});

test("a self-hosted voice connection offers a separate transcription server", async ({
  page,
}, testInfo) => {
  // The screenshot never submits the form or contacts a speech server.
  const stamp = Date.now();
  await signup(page, `voice-stt-${stamp}@rakazo.test`, "password12", "Voice Transcription Preview");
  await completeOnboarding(page);
  await openVoiceSettings(page);
  const voice = page.getByTestId("voice-settings");
  await chooseOption(voice.getByRole("combobox", { name: "Provider" }), "Self-hosted");
  await voice.getByLabel("Server URL", { exact: true }).fill("http://127.0.0.1:8880/v1");
  await expect(voice.getByLabel("Transcription API key")).toHaveCount(0);
  await voice.getByLabel("Transcription server URL").fill("http://127.0.0.1:8881/v1");
  await expect(voice.getByLabel("Transcription API key")).toBeVisible();
  const vocabulary = voice.getByLabel("Transcription vocabulary", { exact: true });
  await expect(vocabulary).toBeVisible();
  await vocabulary.fill("Acme, Xyla");
  await voice.getByLabel("Transcription API key").scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, "voice-self-hosted-transcription-server");
});

test("automatic call language is opt-in and persists on this device", async ({
  page,
}, testInfo) => {
  await signup(page, `voice-language-${Date.now()}@rakazo.test`, "password12", "Voice Preview");
  await completeOnboarding(page);
  await openVoiceSettings(page);
  const setting = page.getByRole("switch", { name: "Detect call language automatically" });
  await expect(setting).not.toBeChecked();
  await setting.click();
  await expect(setting).toBeChecked();
  await setting.scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, "voice-automatic-language");
  await page.reload();
  await expect(setting).toBeChecked();
});

// BondBot leaves Voice out of the settings list; its page still opens from its address.
async function openVoiceSettings(page: Page) {
  await page.goto("/app?settings=voice");
  await expect(page.getByTestId("user-settings")).toHaveAttribute("data-settings-section", "voice");
}
