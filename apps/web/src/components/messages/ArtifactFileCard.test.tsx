// @vitest-environment jsdom
import { deferred } from "@rakazo/core/test-async";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  download: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock("../../lib/pages/artifact-open", () => ({
  fetchArtifactBytes: mocks.fetch,
  downloadArtifact: mocks.download,
  downloadArtifactBytes: vi.fn(),
  canShareArtifacts: () => false,
  shareArtifact: vi.fn(),
  shareArtifactBytes: vi.fn(),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    `«${strings.reduce((text, part, index) => text + part + (values[index] ?? ""), "")}»`,
}));
vi.mock("./PdfViewer", () => ({ PdfViewer: () => null }));
vi.mock("@rakazo/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("./SandboxedHtmlViewer", () => ({ SandboxedHtmlViewer: () => <iframe title="HTML" /> }));

import { ArtifactFileCard } from "./ArtifactFileCard";

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = mocks.create;
      static override revokeObjectURL = mocks.revoke;
    },
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.create.mockReset().mockReturnValue("blob:audio-preview");
  mocks.revoke.mockReset();
  mocks.fetch.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.download.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// BondBot plays audio with its voice note player, which loads a small clip as it comes into view
// (at once here, where there is no IntersectionObserver) and a large one only on play.
const LARGE = 9 * 1024 * 1024;

function renderClip(artifactId = "audio-1", size = 3) {
  root?.render(
    <ArtifactFileCard
      target={{ groupId: "group-1" }}
      artifactId={artifactId}
      name="clip"
      mimeType="audio/mpeg"
      size={size}
    />,
  );
}

const playButton = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label="Play voice note"]')!;
const downloadButton = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label="Download clip"]')!;
const source = () => container.querySelector("audio")?.getAttribute("src") ?? null;

it.each(["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"])(
  "loads %s, keeps download, and revokes the playback URL",
  async (mimeType) => {
    await act(async () =>
      root?.render(
        <ArtifactFileCard
          target={{ botId: "bot-1" }}
          artifactId="audio-1"
          name="clip"
          mimeType={mimeType}
          size={3}
        />,
      ),
    );
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith({ botId: "bot-1" }, "audio-1");
    expect(source()).toBe("blob:audio-preview");
    expect(mocks.create.mock.calls[0]?.[0].type).toBe(mimeType);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    await act(async () => playButton().click());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    await act(async () => downloadButton().click());
    expect(mocks.download).toHaveBeenCalledWith({ botId: "bot-1" }, "audio-1", "clip", mimeType);
    await act(async () => root?.unmount());
    root = undefined;
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:audio-preview");
  },
);

it("retains the download control when playback bytes fail to load", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => renderClip());
  expect(source()).toBeNull();
  expect(container.textContent).toContain("Could not load. Tap play to retry.");
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => downloadButton().click());
  expect(mocks.download).toHaveBeenCalledWith(
    { groupId: "group-1" },
    "audio-1",
    "clip",
    "audio/mpeg",
  );
});

it("downloads a large clip without fetching it for playback", async () => {
  await act(async () => renderClip("audio-1", LARGE));
  await act(async () => downloadButton().click());
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(source()).toBeNull();
});

it.each(["unmount", "change"])(
  "ignores pending bytes after %s and suppresses duplicate play",
  async (cleanup) => {
    const bytes = deferred<Uint8Array>();
    mocks.fetch.mockReturnValueOnce(bytes.promise);
    await act(async () => renderClip("audio-1", LARGE));
    await act(async () => {
      playButton().click();
      playButton().click();
    });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith({ groupId: "group-1" }, "audio-1");
    expect(playButton().getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      if (cleanup === "change") renderClip("audio-2", LARGE);
      else {
        root?.unmount();
        root = undefined;
      }
    });
    await act(async () => bytes.resolve(new Uint8Array([1])));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(source()).toBeNull();
  },
);

it("revokes the old URL on artifact change", async () => {
  await act(async () => renderClip());
  mocks.create.mockReturnValue("blob:second");
  await act(async () => renderClip("audio-2"));
  expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:audio-preview");
  expect(source()).toBe("blob:second");
});

it("keeps controls when playback is rejected", async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("blocked"));
  await act(async () => renderClip());
  await act(async () => playButton().click());
  expect(playButton()).not.toBeNull();
  expect(container.textContent).not.toContain("Could not load");
});

it("translates every size unit and rolls up instead of 1,024.0 KB or 1,536.0 MB", async () => {
  await act(async () =>
    root?.render(
      <>
        {[512, 1024, 1048575, 1610612736, 1.5 * 1024 ** 4].map((size) => (
          <ArtifactFileCard
            key={size}
            target={{ botId: "b" }}
            artifactId={`a${size}`}
            name={`f${size}.zip`}
            mimeType="application/zip"
            size={size}
          />
        ))}
      </>,
    ),
  );
  const sizes = [...container.querySelectorAll("button span:last-child")].map(
    (el) => el.textContent,
  );
  expect(sizes).toEqual(["«512 B»", "«1 KB»", "«1 MB»", "«1.5 GB»", "«1.5 TB»"]);
});

it("aligns filenames and the download divider with the reading direction", async () => {
  await act(async () =>
    root?.render(
      <>
        <ArtifactFileCard
          target={{ botId: "bot-1" }}
          artifactId="notes-1"
          name="notes.txt"
          mimeType="text/plain"
          size={33}
        />
        <ArtifactFileCard
          target={{ botId: "bot-1" }}
          artifactId="archive-1"
          name="archive.zip"
          mimeType="application/zip"
          size={33}
        />
      </>,
    ),
  );
  const preview = container.querySelector('button[aria-label="Preview notes.txt"]')!;
  const download = container.querySelector('button[aria-label="Download notes.txt"]')!;
  const archive = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("archive.zip"),
  )!;
  expect(preview.classList.contains("text-start")).toBe(true);
  expect(archive.classList.contains("text-start")).toBe(true);
  expect(download.classList.contains("border-s")).toBe(true);
});

it("previews plain text in the app instead of only offering a download", async () => {
  mocks.fetch.mockResolvedValue(new TextEncoder().encode("1. Confirm the pricing page copy."));
  await act(async () =>
    root?.render(
      <ArtifactFileCard
        target={{ botId: "bot-1" }}
        artifactId="notes-1"
        name="notes.txt"
        mimeType="text/plain"
        size={33}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Preview notes.txt"]')?.click(),
  );
  await vi.waitFor(() =>
    expect(document.body.querySelector("pre")?.textContent).toBe(
      "1. Confirm the pricing page copy.",
    ),
  );
});

it("retries failed audio loads in place without duplicate requests", async () => {
  const bytes = deferred<Uint8Array>();
  mocks.fetch
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("still offline"))
    .mockImplementationOnce(() => bytes.promise);
  await act(async () => renderClip());
  expect(container.textContent).toContain("Could not load");
  await act(async () => playButton().click());
  expect(container.textContent).toContain("Could not load");
  await act(async () => {
    playButton().click();
    playButton().click();
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  expect(container.textContent).not.toContain("Could not load");
  await act(async () => bytes.resolve(new Uint8Array([1, 2, 3])));
  expect(source()).toBe("blob:audio-preview");
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
});

it.each(["unmount", "change"])("ignores a rejected retry after %s", async (cleanup) => {
  const late = deferred<Uint8Array>();
  mocks.fetch
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(() => late.promise);
  await act(async () => renderClip());
  await act(async () => playButton().click());
  await act(async () => {
    if (cleanup === "change") renderClip("audio-2");
    else {
      root?.unmount();
      root = undefined;
    }
  });
  await act(async () => late.reject(new Error("late failure")));
  expect(container.textContent).not.toContain("Could not load");
  if (cleanup === "change") {
    expect(mocks.fetch).toHaveBeenLastCalledWith({ groupId: "group-1" }, "audio-2");
    expect(source()).toBe("blob:audio-preview");
  } else expect(mocks.create).not.toHaveBeenCalled();
});

async function openFilePreview(mimeType = "text/markdown") {
  await act(async () =>
    root?.render(
      <ArtifactFileCard
        target={{ botId: "bot-1" }}
        artifactId="file-1"
        name="notes.md"
        mimeType={mimeType}
        size={30}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Preview notes.md"]')!.click(),
  );
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog!;
}

it.each(["text/markdown", "text/plain"])(
  "copies the raw %s source after loading",
  async (mimeType) => {
    const source = "# Notes\n\n**Raw** source";
    const loading = deferred<Uint8Array>();
    mocks.fetch.mockReturnValue(loading.promise);
    const dialog = await openFilePreview(mimeType);
    expect(dialog.querySelector('button[aria-label="Copy notes.md"]')).toBeNull();
    await act(async () => loading.resolve(new TextEncoder().encode(source)));
    const copy = dialog.querySelector<HTMLButtonElement>('button[aria-label="Copy notes.md"]');
    expect(copy).not.toBeNull();
    await act(async () => copy!.click());
    expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith(source);
    expect(copy!.getAttribute("aria-label")).toBe("Copied");
  },
);

it("offers the source to copy by hand when the browser refuses", async () => {
  const source = "# Notes";
  mocks.fetch.mockResolvedValue(new TextEncoder().encode(source));
  mocks.writeText.mockRejectedValue(new Error("denied"));
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
  const dialog = await openFilePreview("text/markdown");
  await act(async () =>
    dialog.querySelector<HTMLButtonElement>('button[aria-label="Copy notes.md"]')!.click(),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Copy notes.md"]')?.value,
    ).toBe(source),
  );
});

it.each(["text/html", "application/pdf", "video/mp4"])(
  "does not offer copy for %s",
  async (mimeType) => {
    mocks.fetch.mockResolvedValue(new TextEncoder().encode("<h1>Notes</h1>"));
    const dialog = await openFilePreview(mimeType);
    expect(dialog.querySelector('button[aria-label^="Copy"]')).toBeNull();
  },
);

it.each(["metaKey", "ctrlKey"])(
  "scopes %s+A from the dialog header to the file body",
  async (modifier) => {
    mocks.fetch.mockResolvedValue(new TextEncoder().encode("File contents"));
    const dialog = await openFilePreview();
    const button = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close preview"]')!;
    button.focus();
    const event = new KeyboardEvent("keydown", {
      key: "a",
      [modifier]: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => button.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toBe("File contents");
    expect(window.getSelection()?.getRangeAt(0).commonAncestorContainer).toBe(
      dialog.querySelector("article"),
    );
  },
);

it.each(["input", "textarea", "contenteditable"])(
  "preserves select-all inside %s",
  async (kind) => {
    mocks.fetch.mockResolvedValue(new TextEncoder().encode("File contents"));
    const dialog = await openFilePreview();
    const editable = document.createElement(kind === "contenteditable" ? "div" : kind);
    if (kind === "contenteditable") editable.setAttribute("contenteditable", "true");
    dialog.append(editable);
    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => editable.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  },
);
