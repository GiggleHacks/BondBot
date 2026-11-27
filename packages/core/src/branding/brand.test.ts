import { describe, expect, it } from "vitest";
import { rebrand, rebrandCatalog } from "./brand.js";

describe("rebrand", () => {
  it("renames the product and leaves the hosted service, addresses and ids alone", () => {
    expect(rebrand("Rakazo’s server. Rakazo가")).toBe("BondBot’s server. BondBot가");
    expect(rebrand("Rakazo Cloud, rakazo.com, rakazo-shared")).toBe(
      "Rakazo Cloud, rakazo.com, rakazo-shared",
    );
  });

  it("renames nested catalog entries without touching message ids", () => {
    expect(
      rebrandCatalog({ Rakazo: ["Open Rakazo ", ["n", "plural", { one: "one Rakazo" }]] }),
    ).toEqual({ Rakazo: ["Open BondBot ", ["n", "plural", { one: "one BondBot" }]] });
  });
});
