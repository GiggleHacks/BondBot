// Local addition (David, 2026-11-20): shows which model vendor a bot is using in the sidebar roster.
// Icons are the MIT-licensed @lobehub/icons-static-svg marks, served from /model-icons/.

type Brand = { label: string; file: string; mono: boolean; color?: string };

const BRANDS: Record<string, Brand> = {
  xai: { label: "xAI Grok", file: "xai.svg", mono: true },
  anthropic: { label: "Anthropic Claude", file: "anthropic.svg", mono: true, color: "#D97757" },
  deepseek: { label: "DeepSeek", file: "deepseek-color.svg", mono: false },
  openai: { label: "OpenAI", file: "openai.svg", mono: true },
  google: { label: "Google Gemini", file: "gemini-color.svg", mono: false },
  meta: { label: "Meta Llama", file: "meta-color.svg", mono: false },
  mistral: { label: "Mistral", file: "mistral-color.svg", mono: false },
  qwen: { label: "Qwen", file: "qwen-color.svg", mono: false },
  moonshot: { label: "Moonshot Kimi", file: "moonshot.svg", mono: true },
  zhipu: { label: "Zhipu GLM", file: "zhipu-color.svg", mono: false },
};

/** The vendor behind a model. The model id wins: an openai-compatible endpoint can serve any vendor. */
export function modelBrandKey(
  modelProvider: string | null | undefined,
  modelId: string | null | undefined,
): string | null {
  const id = (modelId ?? "").toLowerCase();
  const provider = (modelProvider ?? "").toLowerCase();
  if (/grok|x-ai/.test(id)) return "xai";
  if (/claude|anthropic/.test(id)) return "anthropic";
  if (/deepseek/.test(id)) return "deepseek";
  if (/gemini|gemma/.test(id)) return "google";
  if (/llama/.test(id)) return "meta";
  if (/mistral|mixtral|codestral/.test(id)) return "mistral";
  if (/qwen/.test(id)) return "qwen";
  if (/kimi|moonshot/.test(id)) return "moonshot";
  if (/glm|zhipu/.test(id)) return "zhipu";
  if (/(^|[/:-])(gpt|chatgpt|codex|o\d)|openai\//.test(id)) return "openai";
  if (provider === "xai") return "xai";
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  if (provider === "google") return "google";
  return null;
}

export function ModelBrandIcon({
  modelProvider,
  modelId,
}: {
  modelProvider: string | null | undefined;
  modelId: string | null | undefined;
}) {
  const key = modelBrandKey(modelProvider, modelId);
  if (!key) return null;
  const brand = BRANDS[key];
  if (!brand) return null;
  const url = `/model-icons/${brand.file}`;
  const title = modelId ? `${brand.label} · ${modelId}` : brand.label;
  if (brand.mono) {
    return (
      <span
        role="img"
        aria-label={title}
        title={title}
        data-roster-model={key}
        className="inline-block size-3.5 shrink-0 bg-current text-foreground/80"
        style={{
          ...(brand.color ? { color: brand.color } : {}),
          WebkitMaskImage: `url(${url})`,
          maskImage: `url(${url})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
    );
  }
  return (
    <img
      src={url}
      alt={title}
      title={title}
      data-roster-model={key}
      draggable={false}
      className="inline-block size-3.5 shrink-0"
    />
  );
}
