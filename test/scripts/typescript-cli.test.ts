import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("TypeScript CLI package scripts", () => {
  it("uses the same transforming runtime for every TypeScript entry point", () => {
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        dev: "tsx scripts/with-secrets.ts --env develop -- cf dev --mode develop",
        "cf-typegen": "cf workers types",
        "test:live-chat": "tsx scripts/test-live-chat.ts",
        secrets: "tsx scripts/create-config.ts",
        "secrets:deploy": "tsx scripts/deploy-secrets.ts",
      }),
    );
    expect(Object.values(packageJson.scripts).join("\n")).not.toContain(
      "ts-node",
    );
  });
});
