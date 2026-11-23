// Local addition (David, 2026-11-21): short, readable model names and the colour each maker gets.
const WORDS: Record<string, string> = {
  gpt: "GPT",
  deepseek: "DeepSeek",
  xai: "xAI",
  glm: "GLM",
  grok: "Grok",
  claude: "Claude",
  gemini: "Gemini",
  gemma: "Gemma",
  llama: "Llama",
  qwen: "Qwen",
  kimi: "Kimi",
  mistral: "Mistral",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  flash: "Flash",
  pro: "Pro",
  mini: "Mini",
  turbo: "Turbo",
  uncensored: "Unc.",
};

/** "claude-sonnet-5-5" -> "Claude Sonnet 5.5"; "deepseek-v4-1-flash-uncensored" -> "DeepSeek 4.1 Flash Unc.". */
export function shortModelLabel(modelId: string): string {
  let id = (modelId.split("/").pop() ?? modelId).trim();
  id = id.replace(/(^|-)\d{8}(?=$|-)/g, ""); // a date suffix such as -20250929
  id = id.replace(/(^|-)v(\d+)-(\d+)(?=$|-)/gi, "$1$2.$3"); // v4-1 -> 4.1
  id = id.replace(/(^|-)(\d+)-(\d+)(?=$|-)/g, "$1$2.$3"); // 5-5 -> 5.5
  const tokens = id.split(/[-_:\s]+/).filter(Boolean);
  if (tokens.length === 0) return modelId;
  // DeepSeek's "flash" is its everyday tier; the version and variant are what tell them apart.
  const kept = tokens[0]?.toLowerCase() === "deepseek" ? tokens.filter((token) => token.toLowerCase() !== "flash") : tokens;
  return kept
    .map((token) => WORDS[token.toLowerCase()] ?? token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

/** The colour of the faint edge around the chat; Grok follows the text colour (silver on dark, black on light). */
export const MODEL_GLOW_COLORS: Record<string, string> = {
  xai: "currentColor",
  deepseek: "#4d6bfe",
  anthropic: "#D97757",
};

/** Inset shadow for a colour; `currentColor` is mixed so it never turns solid. */
export function glowShadow(color: string): string {
  const mix = (percent: number) =>
    color === "currentColor"
      ? `color-mix(in srgb, currentColor ${percent}%, transparent)`
      : `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  return `inset 0 0 0 1px ${mix(38)}, inset 0 0 34px ${mix(16)}`;
}
