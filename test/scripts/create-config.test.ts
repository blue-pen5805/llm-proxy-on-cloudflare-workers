import { readFileSync, writeFileSync, existsSync } from "fs";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  MockedFunction,
} from "vitest";

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

// Mock readline module - note: we don't import createInterface at the top
// since node:readline is not available in Workers environment
const mockQuestion = vi.fn();
const mockClose = vi.fn();
const mockCreateInterface = vi.fn(() => ({
  question: mockQuestion,
  close: mockClose,
}));
vi.mock("readline", () => ({
  createInterface: mockCreateInterface,
}));

// Mock process.exit
const mockExit = vi.fn();
const originalProcessExit = process.exit;

// Mock console.log and console.error
const mockConsoleLog = vi.fn();
const mockConsoleError = vi.fn();
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe("create-config.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = mockExit as never; // Type assertion to satisfy TypeScript
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
  });

  afterEach(() => {
    process.exit = originalProcessExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it("should create config.jsonc when it does not exist and user provides valid input", async () => {
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(
      false,
    ); // config.jsonc does not exist
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(true); // config.example.jsonc exists

    (readFileSync as MockedFunction<typeof readFileSync>).mockReturnValueOnce(`{
      "$schema": "../schemas/config-schema.json",
      "PROXY_API_KEY": "your-proxy-api-key",
      "OPENAI_API_KEY": "sk-...",
      "GEMINI_API_KEY": ["YOUR_GEMINI_API_KEY_1", "YOUR_GEMINI_API_KEY_2"],
      // --- Other API Keys ---
      "ANTHROPIC_API_KEY": "sk-ant-...",
      "CLOUDFLARE_ACCOUNT_ID": "your-account-id",
      "DEV": false
    }`);

    // Set up mockQuestion to handle callback-based interface for this test
    const responses = ["my-proxy-key", "sk-openai-test", "", ""];
    let responseIndex = 0;
    mockQuestion.mockImplementation(
      (prompt: string, callback: (answer: string) => void) => {
        const response = responses[responseIndex++] || "";
        callback(response);
      },
    );

    // Dynamically import the script after mocks are set up
    const { main } = await import("../../scripts/create-config");
    await main();

    expect(existsSync).toHaveBeenCalledWith("config.jsonc");
    expect(existsSync).toHaveBeenCalledWith("config.example.jsonc");
    expect(readFileSync).toHaveBeenCalledWith("config.example.jsonc", "utf8");
    expect(mockCreateInterface).toHaveBeenCalledTimes(1);
    expect(mockQuestion).toHaveBeenCalledTimes(4); // PROXY_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledWith(
      "config.jsonc",
      expect.stringContaining('"PROXY_API_KEY": "my-proxy-key"'),
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      "config.jsonc",
      expect.stringContaining('"OPENAI_API_KEY": "sk-openai-test"'),
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      "config.jsonc",
      expect.not.stringContaining('"GEMINI_API_KEY":'),
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      "config.jsonc",
      expect.not.stringContaining('"ANTHROPIC_API_KEY":'),
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining("✅ config.jsonc created successfully!"),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should exit if config.jsonc exists and user chooses not to overwrite", async () => {
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(true); // config.jsonc exists

    // Set up mockQuestion to handle callback-based interface for this test
    const responses = ["n"];
    let responseIndex = 0;
    mockQuestion.mockImplementation(
      (prompt: string, callback: (answer: string) => void) => {
        const response = responses[responseIndex++] || "";
        callback(response);
      },
    );

    const { main } = await import("../../scripts/create-config");
    await main();

    expect(mockQuestion).toHaveBeenCalledWith(
      "config.jsonc already exists. Overwrite? (y/N): ",
      expect.any(Function),
    );
    expect(mockConsoleLog).toHaveBeenCalledWith("Cancelled.");
    expect(mockExit).toHaveBeenCalledWith(0);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("should exit with error if config.example.jsonc is not found", async () => {
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(
      false,
    ); // config.jsonc does not exist
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(
      false,
    ); // config.example.jsonc does not exist

    const { main } = await import("../../scripts/create-config");
    await main();

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining("Error: config.example.jsonc not found."),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("should prompt again for required fields if input is empty", async () => {
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(
      false,
    ); // config.jsonc does not exist
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(true); // config.example.jsonc exists

    (readFileSync as MockedFunction<typeof readFileSync>).mockReturnValueOnce(`{
      "$schema": "../schemas/config-schema.json",
      "PROXY_API_KEY": "your-proxy-api-key"
    }`);

    // Set up mockQuestion to handle callback-based interface for this test
    const responses = ["", "valid-proxy-key"]; // First try: empty, Second try: valid
    let responseIndex = 0;
    mockQuestion.mockImplementation(
      (prompt: string, callback: (answer: string) => void) => {
        const response = responses[responseIndex++] || "";
        callback(response);
      },
    );

    const { main } = await import("../../scripts/create-config");
    await main();

    expect(mockQuestion).toHaveBeenCalledTimes(2); // Prompted twice for PROXY_API_KEY
    expect(mockConsoleLog).toHaveBeenCalledWith(
      "This field is required. Please enter a value.",
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      "config.jsonc",
      expect.stringContaining('"PROXY_API_KEY": "valid-proxy-key"'),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should handle JSON array input correctly", async () => {
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(
      false,
    ); // config.jsonc does not exist
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(true); // config.example.jsonc exists

    (readFileSync as MockedFunction<typeof readFileSync>).mockReturnValueOnce(`{
      "$schema": "../schemas/config-schema.json",
      "PROXY_API_KEY": "your-proxy-api-key",
      "GEMINI_API_KEY": ["YOUR_GEMINI_API_KEY_1"]
    }`);

    // Set up mockQuestion to handle callback-based interface for this test
    const responses = ["my-proxy-key", '["key1", "key2"]'];
    let responseIndex = 0;
    mockQuestion.mockImplementation(
      (prompt: string, callback: (answer: string) => void) => {
        const response = responses[responseIndex++] || "";
        callback(response);
      },
    );

    const { main } = await import("../../scripts/create-config");
    await main();

    expect(writeFileSync).toHaveBeenCalledWith(
      "config.jsonc",
      expect.stringContaining('"GEMINI_API_KEY": ["key1","key2"]'),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should warn if no API keys are configured", async () => {
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(
      false,
    ); // config.jsonc does not exist
    (existsSync as MockedFunction<typeof existsSync>).mockReturnValueOnce(true); // config.example.jsonc exists

    (readFileSync as MockedFunction<typeof readFileSync>).mockReturnValueOnce(`{
      "$schema": "../schemas/config-schema.json",
      "PROXY_API_KEY": "your-proxy-api-key",
      "OPENAI_API_KEY": "sk-...",
      "GEMINI_API_KEY": ["YOUR_GEMINI_API_KEY_1"]
    }`);

    // Set up mockQuestion to handle callback-based interface for this test
    const responses = ["my-proxy-key", "", ""]; // Only PROXY_API_KEY is set
    let responseIndex = 0;
    mockQuestion.mockImplementation(
      (prompt: string, callback: (answer: string) => void) => {
        const response = responses[responseIndex++] || "";
        callback(response);
      },
    );

    const { main } = await import("../../scripts/create-config");
    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Warning: No API keys configured. At least one provider API key is recommended.",
      ),
    );
    expect(mockExit).not.toHaveBeenCalled();
  });
});
