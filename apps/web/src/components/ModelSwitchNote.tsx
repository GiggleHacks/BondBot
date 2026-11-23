// Local addition (David, 2026-11-21): the small centred note in the chat where the bot's model was switched.
import { ModelBrandIcon, modelBrandKey } from "./ModelBrandIcon";
import { modelGlowColorFor } from "./ModelEdgeGlow";
import { shortModelLabel } from "../lib/model-label";

export function ModelSwitchNote({
  provider,
  modelId,
  createdAt,
}: {
  provider: string;
  modelId: string;
  createdAt?: string;
}) {
  const color = modelGlowColorFor(provider, modelId) ?? "currentColor";
  const time = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  return (
    <div
      data-testid="model-switch-note"
      title={time ? `Switched at ${time}` : undefined}
      className="flex w-full justify-center py-0.5"
    >
      <span
        className="inline-flex max-w-[92%] items-center gap-1 rounded-full border px-2 text-[10.5px] leading-4 text-muted-foreground"
        style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}
      >
        {modelBrandKey(provider, modelId) ? (
          <ModelBrandIcon modelProvider={provider} modelId={modelId} className="size-3" />
        ) : null}
        <span className="truncate">{`Switched to ${shortModelLabel(modelId)} · High`}</span>
      </span>
    </div>
  );
}
