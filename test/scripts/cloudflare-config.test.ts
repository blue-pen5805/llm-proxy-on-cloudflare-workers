import { describe, expect, it } from "vitest";
import config from "../../cloudflare.config";

describe("Cloudflare deployment configuration", () => {
  it("targets a distinct Worker for the develop mode used by the dev script", () => {
    const base = config({ mode: undefined, isPreview: false });
    const develop = config({ mode: "develop", isPreview: false });
    expect(develop.worker.name).toBe(`${base.worker.name}-develop`);
    expect({ ...develop.worker, name: base.worker.name }).toEqual(base.worker);
  });

  it("rejects undeclared modes instead of silently updating the default Worker", () => {
    expect(() => config({ mode: "production", isPreview: false })).toThrow(
      "Unknown deployment mode: production",
    );
  });
});
