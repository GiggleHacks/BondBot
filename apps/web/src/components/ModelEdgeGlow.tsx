// Local addition (David, 2026-11-21): a very faint colour around the chat that follows the bot's model maker.
import { modelBrandKey } from "./ModelBrandIcon";
import { glowShadow, MODEL_GLOW_COLORS } from "../lib/model-label";
import { modelGlowPreference } from "../lib/model-glow-pref";

export function modelGlowColorFor(
  provider: string | null | undefined,
  modelId: string | null | undefined,
): string | null {
  const key = modelBrandKey(provider, modelId);
  return key ? (MODEL_GLOW_COLORS[key] ?? null) : null;
}

export function ModelEdgeGlow({
  provider,
  modelId,
}: {
  provider: string | null | undefined;
  modelId: string | null | undefined;
}) {
  const enabled = modelGlowPreference.use();
  const color = enabled ? modelGlowColorFor(provider, modelId) : null;
  return (
    <div
      aria-hidden="true"
      data-testid="model-edge-glow"
      data-color={color ?? ""}
      className="pointer-events-none absolute inset-0 -z-10 text-foreground transition-[box-shadow] duration-500"
      style={{ boxShadow: color ? glowShadow(color) : "none" }}
    />
  );
}
