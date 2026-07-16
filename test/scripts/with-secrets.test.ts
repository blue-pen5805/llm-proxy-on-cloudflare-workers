import { cleanup, main, parseArgs } from "../../scripts/with-secrets";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  spawn: vi.fn(),
  generateDevVars: vi.fn(),
  getFilePaths: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    unlinkSync: mocks.unlinkSync,
  },
}));

vi.mock("child_process", () => ({ spawn: mocks.spawn }));

vi.mock("../../scripts/generate-dev-vars.ts", () => ({
  generateDevVars: mocks.generateDevVars,
  getFilePaths: mocks.getFilePaths,
}));

describe("with-secrets", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  describe("parseArgs", () => {
    it("parses an environment and a command with arguments", () => {
      expect(
        parseArgs(["--env", "develop", "--", "wrangler", "dev", "--local"]),
      ).toEqual({
        env: "develop",
        command: ["wrangler", "dev", "--local"],
      });
    });

    it("accepts a command without an environment", () => {
      expect(parseArgs(["--", "npm", "test"])).toEqual({
        env: undefined,
        command: ["npm", "test"],
      });
    });

    it("rejects malformed invocations", () => {
      expect(() => parseArgs(["--env"])).toThrow("--env requires a value");
      expect(() => parseArgs(["--unknown"])).toThrow(
        "Unknown argument: --unknown",
      );
      expect(() => parseArgs(["--env", "dev"])).toThrow(
        "No command specified.",
      );
    });
  });

  describe("cleanup", () => {
    it("does nothing when the generated file does not exist", () => {
      mocks.existsSync.mockReturnValue(false);

      cleanup("/repo/.dev.vars");

      expect(mocks.unlinkSync).not.toHaveBeenCalled();
    });

    it("deletes an existing generated file", () => {
      mocks.existsSync.mockReturnValue(true);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      cleanup("/repo/.dev.vars.develop");

      expect(mocks.unlinkSync).toHaveBeenCalledWith("/repo/.dev.vars.develop");
      expect(log).toHaveBeenCalledWith("🧹 Cleaned up .dev.vars.develop");
    });

    it("reports file deletion failures", () => {
      const error = new Error("locked");
      mocks.existsSync.mockReturnValue(true);
      mocks.unlinkSync.mockImplementation(() => {
        throw error;
      });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      cleanup("/repo/.dev.vars");

      expect(consoleError).toHaveBeenCalledWith(
        "❌ Failed to cleanup .dev.vars",
        error,
      );
    });
  });

  it("generates secrets, runs the command, and installs cleanup handlers", async () => {
    const expectedRootDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    process.argv = [
      "node",
      "with-secrets.ts",
      "--env",
      "dev",
      "--",
      "tool",
      "arg",
    ];
    mocks.generateDevVars.mockReturnValue({
      success: true,
      messages: ["generated"],
    });
    mocks.getFilePaths.mockReturnValue({
      devVarsPath: "/repo/.dev.vars.dev",
    });
    mocks.existsSync.mockReturnValue(true);

    const childHandlers = new Map<string, (code: number | null) => void>();
    mocks.spawn.mockReturnValue({
      on: vi.fn((event: string, handler: (code: number | null) => void) => {
        childHandlers.set(event, handler);
      }),
    });
    const processHandlers = new Map<string, () => void>();
    vi.spyOn(process, "on").mockImplementation((event, handler) => {
      processHandlers.set(String(event), handler as () => void);
      return process;
    });
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await main();

    expect(mocks.generateDevVars).toHaveBeenCalledWith(expectedRootDir, "dev");
    expect(mocks.spawn).toHaveBeenCalledWith("tool", ["arg"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    expect([...processHandlers.keys()]).toEqual(["exit", "SIGINT", "SIGTERM"]);

    childHandlers.get("close")?.(7);
    expect(mocks.unlinkSync).toHaveBeenCalledWith("/repo/.dev.vars.dev");
    expect(exit).toHaveBeenCalledWith(7);

    childHandlers.get("close")?.(null);
    expect(exit).toHaveBeenCalledWith(0);
    processHandlers.get("exit")?.();
    processHandlers.get("SIGINT")?.();
    processHandlers.get("SIGTERM")?.();
    expect(exit).toHaveBeenCalledTimes(4);
  });

  it("exits with a diagnostic when arguments are invalid", async () => {
    process.argv = ["node", "with-secrets.ts", "--bad"];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process exited");
    }) as never);

    await expect(main()).rejects.toThrow("process exited");
    expect(consoleError).toHaveBeenCalledWith(
      "❌ Unknown argument: --bad. Use '--' to separate the command.",
    );
  });

  it("prints generation errors and exits before spawning", async () => {
    process.argv = ["node", "with-secrets.ts", "--", "tool"];
    mocks.generateDevVars.mockReturnValue({
      success: false,
      messages: ["missing config", "generation failed"],
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process exited");
    }) as never);

    await expect(main()).rejects.toThrow("process exited");
    expect(consoleError).toHaveBeenCalledWith("missing config");
    expect(consoleError).toHaveBeenCalledWith("generation failed");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
