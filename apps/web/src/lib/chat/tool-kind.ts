export type ToolKind = "shell" | "web" | "computer" | "files" | "memory" | "other";

/** Matched against the words of a tool's name, which is what a step's label is made from. */
const KINDS: [ToolKind, RegExp][] = [
  ["memory", /\b(memory|remember|recall|knowledge)\b/i],
  ["shell", /\b(bash|shell|terminal|exec|command|process)\b/i],
  ["web", /\b(web|browser|browse|search|fetch|url|page)\b/i],
  ["computer", /\b(computer|screen|screenshot|click|desktop)\b/i],
  ["files", /\b(file|files|read|write|edit|attach|artifact|grep|glob)\b/i],
];

export function toolKind(label: string): ToolKind {
  return KINDS.find(([, words]) => words.test(label))?.[0] ?? "other";
}
