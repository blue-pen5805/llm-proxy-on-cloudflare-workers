import { readFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLiveChatCli } from "../../scripts/test-live-chat";

vi.mock("fs", () => ({ readFileSync: vi.fn() }));

describe("live Chat Completions CLI", () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalTimeout = process.env.LIVE_CHAT_TIMEOUT_MS;
  const originalKeySelection = process.env.LLM_PROXY_KEY_SELECTION;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.argv = ["node", "test-live-chat.ts"];
    process.exitCode = undefined;
    vi.mocked(readFileSync).mockReset();
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    if (originalTimeout === undefined) delete process.env.LIVE_CHAT_TIMEOUT_MS;
    else process.env.LIVE_CHAT_TIMEOUT_MS = originalTimeout;
    if (originalKeySelection === undefined)
      delete process.env.LLM_PROXY_KEY_SELECTION;
    else process.env.LLM_PROXY_KEY_SELECTION = originalKeySelection;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prints help", async () => {
    process.argv.push("--help");

    await runLiveChatCli();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Usage: npm run test:live-chat"),
    );
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("runs configured checks and prints a summary", async () => {
    process.env.LIVE_CHAT_TIMEOUT_MS = "1000";
    process.env.LLM_PROXY_KEY_SELECTION = "none";
    vi.mocked(readFileSync)
      .mockReturnValueOnce('{"providers":{"ollama":"model-test"}}')
      .mockReturnValueOnce('{"DEV":true}');
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
    );

    await runLiveChatCli();

    expect(log).toHaveBeenCalledWith("PASS ollama direct: HTTP 204");
    expect(log).toHaveBeenCalledWith(
      "2/2 live Chat Completions checks passed.",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("sets a failure exit code for failed checks and invalid arguments", async () => {
    vi.mocked(readFileSync)
      .mockReturnValueOnce('{"providers":{"ollama":"model-test"}}')
      .mockReturnValueOnce('{"DEV":true}');
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValue(new Response(null, { status: 500 })),
    );

    await runLiveChatCli();

    expect(log).toHaveBeenCalledWith(
      "FAIL ollama direct: HTTP 500 Internal Server Error",
    );
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    process.argv.push("--unknown");
    await runLiveChatCli();
    expect(error).toHaveBeenCalledWith(
      "Live Chat Completions test failed: Unexpected argument: --unknown",
    );
    expect(process.exitCode).toBe(1);
  });
});
