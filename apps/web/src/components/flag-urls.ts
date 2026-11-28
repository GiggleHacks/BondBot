/** Every country's flag as a file of its own, loaded only when a flag we do not draw is shown. */
const files = import.meta.glob<string>("../../node_modules/flag-icons/flags/4x3/??.svg", {
  eager: true,
  import: "default",
  query: "?url",
});

const urls = new Map(
  Object.entries(files).map(([path, url]) => [path.slice(-6, -4).toUpperCase(), url]),
);
// "UN" is how an unknown country is written, not the United Nations.
urls.delete("UN");

export function flagUrl(code: string): string | undefined {
  return urls.get(code);
}
