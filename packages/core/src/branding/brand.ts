// Local addition (BondBot): upstream copy and translation catalogs say "Rakazo". Renaming at the
// point text is shown keeps every language translated without editing catalogs or message ids.

/** The product name people read. */
export const BRAND_NAME = "BondBot";

// "Rakazo Cloud" is upstream's hosted service, so it keeps its name. Case-sensitive, so addresses
// and ids such as `rakazo.com` or `rakazo-shared` are untouched.
const UPSTREAM_NAME = /\bRakazo\b(?! Cloud)/g;

export function rebrand(text: string): string {
  return text.replace(UPSTREAM_NAME, BRAND_NAME);
}

/** Every string in a compiled message catalog, at any depth, renamed. */
export function rebrandCatalog<T>(catalog: T): T {
  if (typeof catalog === "string") return rebrand(catalog) as T;
  if (Array.isArray(catalog)) return catalog.map(rebrandCatalog) as T;
  if (!catalog || typeof catalog !== "object") return catalog;
  return Object.fromEntries(
    Object.entries(catalog).map(([key, value]) => [key, rebrandCatalog(value)]),
  ) as T;
}
