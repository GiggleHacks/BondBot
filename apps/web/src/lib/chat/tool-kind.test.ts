import { expect, it } from "vitest";
import { toolKind } from "./tool-kind";

it.each([
  ["Bash", "shell"],
  ["Web search", "web"],
  ["Computer use", "computer"],
  ["Read file", "files"],
  ["Save memory", "memory"],
  ["Send message", "other"],
])("colours %s as a %s tool", (label, kind) => {
  expect(toolKind(label)).toBe(kind);
});
