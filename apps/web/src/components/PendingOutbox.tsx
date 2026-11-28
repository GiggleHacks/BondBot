// Local addition: a send lands in the chat immediately, then uploads with speed and a bar.
import { isModelRequiredSendError } from "@rakazo/core";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ArtifactTarget } from "../lib/pages/artifact-open";
import type { SendItem } from "../lib/send-queue";
import { sendQueue } from "../lib/send-queue";
import { UploadMeter } from "./UploadMeter";

function sameTarget(item: SendItem, target: ArtifactTarget): boolean {
  return "groupId" in item.target
    ? "groupId" in target && item.target.groupId === target.groupId
    : "botId" in target && item.target.botId === target.botId;
}

function label(item: SendItem, online: boolean): string {
  if (item.state === "failed") return item.error ?? "Could not send";
  if (item.state === "confirm") return "This model can't read images";
  if (!online) return "Waiting for connection";
  if (item.state === "pending") {
    return item.retryAt
      ? item.error
        ? `Retrying: ${item.error}`
        : "Will retry soon"
      : "Waiting for connection";
  }
  return "Sending";
}

/** Messages already handed to the chat, still waiting to reach the server. */
export function PendingOutbox({
  target,
  onConnectModel,
}: {
  target: ArtifactTarget;
  onConnectModel?: () => void;
}) {
  const state = useSyncExternalStore(sendQueue.subscribe, sendQueue.getSnapshot);
  useEffect(() => sendQueue.start(), []);
  const items = state.items.filter((item) => sameTarget(item, target));
  const last = useRef<HTMLDivElement>(null);
  const shown = useRef("");
  const keys = items.map((item) => item.clientNonce).join(",");
  useEffect(() => {
    const fresh = keys.split(",").filter((key) => key && !shown.current.split(",").includes(key));
    shown.current = keys;
    if (fresh.length > 0) last.current?.scrollIntoView({ block: "end" });
  }, [keys]);
  if (items.length === 0) return null;
  return (
    <div data-testid="pending-outbox" className="flex flex-col gap-2">
      {items.map((item, at) => {
        const previews = state.previews[item.clientNonce] ?? [];
        const otherFiles = item.files.filter((file) => !file.mimeType.startsWith("image/"));
        const waiting = !state.online || item.state === "pending";
        return (
          <div
            key={item.clientNonce}
            ref={at === items.length - 1 ? last : undefined}
            data-testid="pending-outbox-item"
            className="flex flex-col items-end gap-1"
          >
            <div className="flex max-w-[min(100%,280px)] flex-col items-end gap-1">
              {previews.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {previews.map((url, index) => (
                    <img
                      key={url}
                      src={url}
                      alt=""
                      className="size-16 rounded-xl object-cover"
                      // biome-ignore lint/suspicious/noArrayIndexKey: preview order is the send order
                      data-index={index}
                    />
                  ))}
                </div>
              ) : null}
              {otherFiles.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {otherFiles.map((file) => (
                    <span
                      key={file.id}
                      // off-scale: file chip in a pending message.
                      className="max-w-[240px] truncate rounded-xl bg-chat-user/85 px-2.5 py-1 text-[12px] text-chat-user-foreground"
                    >
                      {file.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {item.text ? (
                <div className="rounded-2xl bg-chat-user px-3 py-1.5 text-body text-chat-user-foreground">
                  <span className="whitespace-pre-wrap break-words" dir="auto">
                    {item.text}
                  </span>
                </div>
              ) : null}
            </div>
            <UploadMeter
              fraction={waiting && item.loaded === 0 ? 0 : item.fraction}
              bps={item.state === "uploading" ? item.bps : 0}
              label={label(item, state.online)}
              onLabelClick={
                item.state === "failed" && isModelRequiredSendError(item.error)
                  ? onConnectModel
                  : undefined
              }
              onCancel={() => void sendQueue.cancel(item.clientNonce)}
            />
            {item.state === "confirm" ? (
              <button
                type="button"
                // off-scale: inline action under a pending bubble.
                className="text-[11px] text-foreground/80 underline"
                onClick={() => void sendQueue.sendAsFile(item.clientNonce)}
              >
                Send as file
              </button>
            ) : null}
            {item.state === "failed" ||
            (item.state === "pending" && item.retryAt && state.online) ? (
              <button
                type="button"
                // off-scale: inline action under a pending bubble.
                className="text-[11px] text-foreground/80 underline"
                onClick={() => void sendQueue.retry(item.clientNonce)}
              >
                Retry
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
