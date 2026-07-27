import packageJson from "../../package.json";
import { describe, expect, it } from "vitest";

describe("TypeScript CLI package scripts", () => {
  it("uses the same transforming runtime for every TypeScript entry point", () => {
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        dev: "tsx scripts/with-secrets.ts --env develop -- wrangler dev --env-file .dev.vars.develop",
        "cf-typegen":
          "tsx scripts/with-secrets.ts --env example --include-null-placeholders -- wrangler types --env-file .dev.vars.example",
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
