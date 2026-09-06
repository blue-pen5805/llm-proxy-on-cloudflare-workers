import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import configSchema from "../../schemas/config-schema.json";
import {
  CONFIG_TUI_BACK,
  configTuiHelp,
  discoverCloudflareAccounts,
  FIELD_GROUPS,
  getConfigTuiPath,
  mapEscapeToBack,
  parseConfigSource,
  parseConfigTuiArguments,
  PROVIDER_GROUPS,
  runConfigTui,
  runCreateConfigCli,
  TUI_EXCLUDED_FIELDS,
  validateConfig,
  validateConfigFieldInput,
  type CloudflareAccount,
  type ConfigTuiFileSystem,
  type ConfigTuiPrompts,
  type FieldKey,
} from "../../scripts/create-config";

const CANCEL = Symbol("cancel");
const REPOSITORY_ROOT = "/repository";
const EXAMPLE_PATH = `${REPOSITORY_ROOT}/config.example.jsonc`;
const CONFIG_PATH = `${REPOSITORY_ROOT}/config.jsonc`;

const MINIMAL_TEMPLATE = `{
  "$schema": "schemas/config-schema.json",
  // This comment must survive the editor.
  "PROXY_API_KEY": "YOUR-PROXY-API-KEY",
  "CLOUDFLARE_ACCOUNT_ID": null,
  "DEV": false
}
`;

class PromptHarness implements ConfigTuiPrompts {
  readonly intros: string[] = [];
  readonly outros: string[] = [];
  readonly cancellations: string[] = [];
  readonly notes: Array<{ message: string; title?: string }> = [];
  readonly selectMessages: string[] = [];
  readonly selectOptionLabels: string[][] = [];
  readonly selectOptionHints: Array<Array<string | undefined>> = [];
  readonly textMessages: string[] = [];
  readonly passwordMessages: string[] = [];
  readonly multilineMessages: string[] = [];
  readonly confirmMessages: string[] = [];

  constructor(
    readonly answers: {
      selects?: Array<string | symbol>;
      texts?: Array<string | symbol>;
      passwords?: Array<string | symbol>;
      multilines?: Array<string | symbol>;
      confirms?: Array<boolean | symbol>;
    },
  ) {}

  intro = (message: string): void => {
    this.intros.push(message);
  };

  outro = (message: string): void => {
    this.outros.push(message);
  };

  cancel = (message: string): void => {
    this.cancellations.push(message);
  };

  note = (message: string, title?: string): void => {
    this.notes.push({ message, title });
  };

  isCancel = (value: unknown): value is symbol => value === CANCEL;
  isBack = (value: unknown): value is symbol => value === CONFIG_TUI_BACK;

  select = async (options: {
    message: string;
    options: Array<{
      value: string;
      label: string;
      hint?: string;
      disabled?: boolean;
    }>;
  }): Promise<string | symbol> => {
    this.selectMessages.push(options.message);
    this.selectOptionLabels.push(options.options.map((option) => option.label));
    this.selectOptionHints.push(options.options.map((option) => option.hint));
    return this.take(this.answers.selects, "select");
  };

  text = async (options: {
    message: string;
    validate?: (value: string | undefined) => string | undefined;
  }): Promise<string | symbol> => {
    this.textMessages.push(options.message);
    expect(options.validate?.(undefined)).toMatch(
      /^(Enter a value\.|値を入力してください。)$/,
    );
    const value = this.take(this.answers.texts, "text");
    if (typeof value === "string")
      expect(options.validate?.(value)).toBeUndefined();
    return value;
  };

  password = async (options: {
    message: string;
    validate?: (value: string | undefined) => string | undefined;
  }): Promise<string | symbol> => {
    this.passwordMessages.push(options.message);
    expect(options.validate?.(undefined)).toMatch(
      /^(Enter a value\.|値を入力してください。)$/,
    );
    const value = this.take(this.answers.passwords, "password");
    if (typeof value === "string")
      expect(options.validate?.(value)).toBeUndefined();
    return value;
  };

  multiline = async (options: {
    message: string;
    validate?: (value: string | undefined) => string | undefined;
  }): Promise<string | symbol> => {
    this.multilineMessages.push(options.message);
    expect(options.validate?.(undefined)).toMatch(
      /^(Enter a value\.|値を入力してください。)$/,
    );
    const value = this.take(this.answers.multilines, "multiline");
    if (typeof value === "string")
      expect(options.validate?.(value)).toBeUndefined();
    return value;
  };

  confirm = async (options: { message: string }): Promise<boolean | symbol> => {
    this.confirmMessages.push(options.message);
    return this.take(this.answers.confirms, "confirm");
  };

  private take<T>(values: T[] | undefined, promptType: string): T {
    const value = values?.shift();
    if (value === undefined) throw new Error(`Missing ${promptType} answer`);
    return value;
  }
}

function createFileSystem(
  files: Record<string, string>,
): ConfigTuiFileSystem & {
  files: Map<string, string>;
  writes: Array<{ path: string; content: string; mode: number }>;
  chmods: Array<{ path: string; mode: number }>;
} {
  const storedFiles = new Map(Object.entries(files));
  const writes: Array<{ path: string; content: string; mode: number }> = [];
  const chmods: Array<{ path: string; mode: number }> = [];
  return {
    files: storedFiles,
    writes,
    chmods,
    existsSync: (filePath) => storedFiles.has(filePath),
    readFileSync: (filePath) => {
      const content = storedFiles.get(filePath);
      if (content === undefined) throw new Error(`Missing file: ${filePath}`);
      return content;
    },
    writeFileSync: (filePath, content, options) => {
      storedFiles.set(filePath, content);
      writes.push({ path: filePath, content, mode: options.mode });
    },
    chmodSync: (filePath, mode) => {
      chmods.push({ path: filePath, mode });
    },
  };
}

function dependencies(
  prompts: PromptHarness,
  fileSystem: ConfigTuiFileSystem,
  accounts: CloudflareAccount[] = [],
) {
  return {
    prompts,
    fileSystem,
    repositoryRoot: REPOSITORY_ROOT,
    discoverAccounts: vi.fn().mockResolvedValue(accounts),
    language: "en" as const,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configuration TUI", () => {
  it("starts with language selection and presents the session in Japanese", async () => {
    const existing = MINIMAL_TEMPLATE.replace(
      "YOUR-PROXY-API-KEY",
      "existing-proxy",
    ).replace(
      '"DEV": false',
      '"CHAT_RESPONSE_METADATA_ENABLED": false,\n  "AZURE_OPENAI_RESOURCE_NAME": "resource",\n  "DEV": false',
    );
    const prompts = new PromptHarness({
      selects: [
        "ja",
        "__providers",
        "azure-openai",
        "AZURE_OPENAI_RESOURCE_NAME",
        "keep",
        "__back",
        "__back",
        "behavior",
        "CHAT_RESPONSE_METADATA_ENABLED",
        "change",
        "true",
        "__back",
        "__save",
      ],
      confirms: [true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: existing,
    });

    await expect(
      runConfigTui(
        {},
        {
          prompts,
          fileSystem,
          repositoryRoot: REPOSITORY_ROOT,
          discoverAccounts: vi.fn().mockResolvedValue([]),
        },
      ),
    ).resolves.toBe("saved");

    expect(prompts.selectMessages[0]).toBe("Language / 言語");
    expect(prompts.selectOptionLabels[0]).toEqual(["English", "日本語"]);
    expect(prompts.intros).toEqual(["config.jsonc を編集"]);
    expect(prompts.selectOptionLabels.flat()).toEqual(
      expect.arrayContaining([
        "プロキシ認証",
        "プロバイダー",
        "動作設定",
        "リソース名",
        "有効",
        "未設定（実効既定値を使用）",
        "確認して保存",
      ]),
    );
    expect(prompts.confirmMessages).toEqual([
      "config.jsonc をモード 0600 で保存しますか？",
    ]);
    expect(prompts.notes).toContainEqual(
      expect.objectContaining({ title: "保存する値" }),
    );
    expect(prompts.outros[0]).toContain("config.jsonc を更新しました");
  });

  it.each([CANCEL, CONFIG_TUI_BACK])(
    "cancels safely from the initial language selection",
    async (answer) => {
      const prompts = new PromptHarness({ selects: [answer] });
      const fileSystem = createFileSystem({});

      await expect(
        runConfigTui(
          {},
          {
            prompts,
            fileSystem,
            repositoryRoot: REPOSITORY_ROOT,
            discoverAccounts: vi.fn(),
          },
        ),
      ).resolves.toBe("cancelled");
      expect(prompts.cancellations).toEqual([
        "Cancelled. / キャンセルしました。",
      ]);
    },
  );

  it("creates a protected config and defaults the account from Wrangler", async () => {
    const prompts = new PromptHarness({
      passwords: ["client-secret"],
      selects: ["__save"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({ [EXAMPLE_PATH]: MINIMAL_TEMPLATE });

    await expect(
      runConfigTui(
        {},
        dependencies(prompts, fileSystem, [
          { id: "account-id", name: "Example account" },
        ]),
      ),
    ).resolves.toBe("saved");

    expect(fileSystem.writes).toHaveLength(1);
    expect(fileSystem.writes[0]).toMatchObject({
      path: CONFIG_PATH,
      mode: 0o600,
    });
    expect(fileSystem.writes[0].content).toContain(
      '"PROXY_API_KEY": "client-secret"',
    );
    expect(fileSystem.writes[0].content).toContain(
      '"CLOUDFLARE_ACCOUNT_ID": "account-id"',
    );
    expect(fileSystem.writes[0].content).toContain(
      "// This comment must survive the editor.",
    );
    expect(parseConfigSource(fileSystem.writes[0].content).DEV).toBe(false);
    expect(fileSystem.chmods).toEqual([{ path: CONFIG_PATH, mode: 0o600 }]);
    expect(prompts.outros[0]).toContain("config.jsonc created");
    expect(JSON.stringify(prompts.notes)).not.toContain("client-secret");
  });

  it("offers multiple Wrangler accounts and still allows a manual override", async () => {
    const prompts = new PromptHarness({
      passwords: ["client-secret"],
      selects: [
        "second-id",
        "gateway",
        "CLOUDFLARE_ACCOUNT_ID",
        "change",
        "__back",
        "__save",
      ],
      texts: ["manual-id"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({ [EXAMPLE_PATH]: MINIMAL_TEMPLATE });

    await runConfigTui(
      {},
      dependencies(prompts, fileSystem, [
        { id: "first-id", name: "First" },
        { id: "second-id", name: "Second" },
      ]),
    );

    expect(fileSystem.writes[0].content).toContain(
      '"CLOUDFLARE_ACCOUNT_ID": "manual-id"',
    );
  });

  it("can leave the account unset when several accounts are available", async () => {
    const prompts = new PromptHarness({
      passwords: ["client-secret"],
      selects: ["", "__save"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({ [EXAMPLE_PATH]: MINIMAL_TEMPLATE });

    await runConfigTui(
      {},
      dependencies(prompts, fileSystem, [
        { id: "first-id", name: "First" },
        { id: "second-id", name: "Second" },
      ]),
    );

    expect(parseConfigSource(fileSystem.writes[0].content)).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: null,
    });
  });

  it("defaults an unset account while editing an existing file", async () => {
    const prompts = new PromptHarness({
      selects: ["__save"],
      confirms: [true],
    });
    const existing = MINIMAL_TEMPLATE.replace(
      "YOUR-PROXY-API-KEY",
      "existing-proxy",
    );
    const fileSystem = createFileSystem({ [CONFIG_PATH]: existing });

    await runConfigTui(
      {},
      dependencies(prompts, fileSystem, [
        { id: "detected-account", name: "Detected account" },
      ]),
    );

    expect(fileSystem.writes[0].content).toContain(
      '"CLOUDFLARE_ACCOUNT_ID": "detected-account"',
    );
  });

  it("edits scalar, boolean, structured, secret, and nullable existing values", async () => {
    const existing = `{
  "$schema": "schemas/config-schema.json",
  // Preserve operator documentation.
  "PROXY_API_KEY": "old-proxy",
  "CLOUDFLARE_ACCOUNT_ID": "old-account",
  "AI_GATEWAY_NAME": null,
  "CF_AIG_TOKEN": "old-token",
  "OPENAI_API_KEY": "old-provider",
  "ALLOWED_ORIGINS": ["https://old.example.com"],
  "CHAT_RESPONSE_METADATA_ENABLED": false,
  "DEV": false,
  "API_KEY_COOLDOWN_SECONDS": null,
  "CUSTOM_OPENAI_ENDPOINTS": null,
  "VIRTUAL_MODELS": null
}`;
    const prompts = new PromptHarness({
      selects: [
        "gateway",
        "CLOUDFLARE_ACCOUNT_ID",
        "change",
        "AI_GATEWAY_NAME",
        "change",
        "CF_AIG_TOKEN",
        "clear",
        "__back",
        "behavior",
        "CHAT_RESPONSE_METADATA_ENABLED",
        "change",
        "true",
        "API_KEY_COOLDOWN_SECONDS",
        "change",
        "__back",
        "authentication",
        "ALLOWED_ORIGINS",
        "change",
        "__back",
        "__providers",
        "openai",
        "OPENAI_API_KEY",
        "change",
        "__back",
        "aws-bedrock",
        "AWS_BEARER_TOKEN_BEDROCK",
        "change",
        "__back",
        "__back",
        "custom-endpoints",
        "CUSTOM_OPENAI_ENDPOINTS",
        "change",
        "__back",
        "virtual-models",
        "VIRTUAL_MODELS",
        "change",
        "__back",
        "__save",
        "__save",
      ],
      texts: ["manual-account", "custom-gateway", "30"],
      passwords: ['["provider-one","provider-two"]', "bedrock-token", "[]"],
      multilines: [
        '["https://console.example.com"]',
        '{"virtual/fast":["openai/model"]}',
      ],
      confirms: [false, true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: existing,
    });

    await runConfigTui(
      {},
      dependencies(prompts, fileSystem, [
        { id: "wrangler-account", name: "Wrangler account" },
      ]),
    );

    const saved = parseConfigSource(fileSystem.writes[0].content);
    expect(saved).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: "manual-account",
      AI_GATEWAY_NAME: "custom-gateway",
      CF_AIG_TOKEN: null,
      CHAT_RESPONSE_METADATA_ENABLED: true,
      DEV: false,
      API_KEY_COOLDOWN_SECONDS: 30,
      ALLOWED_ORIGINS: ["https://console.example.com"],
      OPENAI_API_KEY: ["provider-one", "provider-two"],
      AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
      CUSTOM_OPENAI_ENDPOINTS: [],
      VIRTUAL_MODELS: { "virtual/fast": ["openai/model"] },
    });
    expect(fileSystem.writes[0].content).toContain(
      "// Preserve operator documentation.",
    );
    expect(
      prompts.notes.some((entry) => entry.title?.includes("Accounts")),
    ).toBe(true);
    expect(prompts.outros[0]).toContain("updated");
    expect(prompts.selectOptionHints.flat()).toContain(
      "not set (effective default: 60)",
    );
    expect(prompts.selectOptionLabels.flat()).toContain("Disabled (default)");
    expect(prompts.selectOptionLabels.flat()).not.toContain("DEV");
    const review = prompts.notes.find(
      (entry) => entry.title === "Values to save",
    )?.message;
    expect(review).toContain("OpenAI — API_KEY: configured (hidden)");
    expect(review).toContain("AWS Bedrock — Bearer token: configured (hidden)");
    expect(review).not.toContain("OPENAI_API_KEY");
  });

  it("selects credentials and settings by provider display name", async () => {
    const prompts = new PromptHarness({
      selects: [
        "__providers",
        "azure-openai",
        CONFIG_TUI_BACK,
        "openai",
        "OPENAI_API_KEY",
        CONFIG_TUI_BACK,
        "OPENAI_API_KEY",
        "keep",
        "__back",
        "google-vertex-ai",
        "__back",
        CONFIG_TUI_BACK,
        "__save",
      ],
      confirms: [true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: MINIMAL_TEMPLATE.replace(
        "YOUR-PROXY-API-KEY",
        "existing-key",
      ),
    });

    await runConfigTui({}, dependencies(prompts, fileSystem));

    const providersIndex = prompts.selectMessages.indexOf("Providers");
    expect(prompts.selectOptionLabels[providersIndex]).toEqual(
      expect.arrayContaining([
        "OpenAI",
        "Google AI Studio",
        "xAI",
        "Anthropic",
        "Google Vertex AI",
        "AWS Bedrock",
      ]),
    );
    expect(prompts.selectOptionLabels[providersIndex]).not.toContain(
      "OPENAI_API_KEY",
    );

    const azureIndex = prompts.selectMessages.indexOf("Azure OpenAI");
    expect(prompts.selectOptionLabels[azureIndex]).toEqual(
      expect.arrayContaining(["API_KEY", "Resource name", "API version"]),
    );
    expect(prompts.selectOptionLabels[azureIndex]).not.toContain(
      "AZURE_OPENAI_API_KEY",
    );

    const mainMenuIndex = prompts.selectMessages.findIndex((message) =>
      message.startsWith("config.jsonc"),
    );
    expect(prompts.selectOptionLabels[mainMenuIndex].slice(0, 6)).toEqual([
      "Proxy authentication",
      "Providers",
      "Custom endpoints",
      "Virtual models",
      "Cloudflare AI Gateway",
      "Behavior",
    ]);
  });

  it("offers an explicit no-change choice and keeps the field unchanged", async () => {
    const prompts = new PromptHarness({
      selects: ["authentication", "PROXY_API_KEY", "keep", "__back", "__save"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: MINIMAL_TEMPLATE.replace(
        "YOUR-PROXY-API-KEY",
        "existing-key",
      ).replace(
        '"CLOUDFLARE_ACCOUNT_ID": null',
        '"CLOUDFLARE_ACCOUNT_ID": "existing-account"',
      ),
    });

    await runConfigTui({}, dependencies(prompts, fileSystem));

    expect(fileSystem.writes[0].content).toContain(
      '"PROXY_API_KEY": "existing-key"',
    );
    expect(prompts.selectOptionLabels.flat()).toContain(
      "Keep current value (no change)",
    );
  });

  it("returns one level from a value prompt when Esc is pressed", async () => {
    const prompts = new PromptHarness({
      selects: [
        "authentication",
        "PROXY_API_KEY",
        "change",
        "keep",
        "__back",
        "__save",
      ],
      passwords: [CONFIG_TUI_BACK],
      confirms: [true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: MINIMAL_TEMPLATE.replace(
        "YOUR-PROXY-API-KEY",
        "existing-key",
      ),
    });

    await runConfigTui({}, dependencies(prompts, fileSystem));

    expect(parseConfigSource(fileSystem.writes[0].content).PROXY_API_KEY).toBe(
      "existing-key",
    );
  });

  it("returns from a section to the main menu when Esc is pressed", async () => {
    const prompts = new PromptHarness({
      selects: ["authentication", CONFIG_TUI_BACK, "__save"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: MINIMAL_TEMPLATE,
    });

    await expect(
      runConfigTui({}, dependencies(prompts, fileSystem)),
    ).resolves.toBe("saved");
  });

  it("returns from a field action to the field list when Esc is pressed", async () => {
    const prompts = new PromptHarness({
      selects: [
        "authentication",
        "PROXY_API_KEY",
        CONFIG_TUI_BACK,
        "__back",
        "__save",
      ],
      confirms: [true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: MINIMAL_TEMPLATE,
    });

    await expect(
      runConfigTui({}, dependencies(prompts, fileSystem)),
    ).resolves.toBe("saved");
  });

  it("shows and applies the effective boolean default", async () => {
    const prompts = new PromptHarness({
      selects: [
        "behavior",
        "CHAT_RESPONSE_METADATA_ENABLED",
        "change",
        "null",
        "__back",
        "__save",
      ],
      confirms: [true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: MINIMAL_TEMPLATE.replace(
        '"DEV": false',
        '"CHAT_RESPONSE_METADATA_ENABLED": true,\n  "DEV": false',
      ),
    });

    await runConfigTui({}, dependencies(prompts, fileSystem));

    expect(
      parseConfigSource(fileSystem.writes[0].content)
        .CHAT_RESPONSE_METADATA_ENABLED,
    ).toBeNull();
    expect(prompts.selectOptionLabels.flat()).toContain(
      "Not set (use effective default)",
    );
  });

  it("returns from save confirmation to the main menu when Esc is pressed", async () => {
    const prompts = new PromptHarness({
      selects: ["__save", "__save"],
      confirms: [CONFIG_TUI_BACK, true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: MINIMAL_TEMPLATE,
    });

    await expect(
      runConfigTui({}, dependencies(prompts, fileSystem)),
    ).resolves.toBe("saved");
  });

  it("returns from initial account selection to proxy configuration", async () => {
    const prompts = new PromptHarness({
      passwords: ["proxy"],
      selects: [CONFIG_TUI_BACK, "keep", "second", "__save"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({ [EXAMPLE_PATH]: MINIMAL_TEMPLATE });

    await runConfigTui(
      {},
      dependencies(prompts, fileSystem, [
        { id: "first", name: "First" },
        { id: "second", name: "Second" },
      ]),
    );

    expect(
      parseConfigSource(fileSystem.writes[0].content).CLOUDFLARE_ACCOUNT_ID,
    ).toBe("second");
  });

  it("continues to the main menu when Esc skips initial account selection while editing", async () => {
    const prompts = new PromptHarness({
      selects: [CONFIG_TUI_BACK, "__save"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: MINIMAL_TEMPLATE,
    });

    await runConfigTui(
      {},
      dependencies(prompts, fileSystem, [
        { id: "first", name: "First" },
        { id: "second", name: "Second" },
      ]),
    );

    expect(
      parseConfigSource(fileSystem.writes[0].content).CLOUDFLARE_ACCOUNT_ID,
    ).toBeNull();
  });

  it("reports account discovery failure and accepts manual configuration", async () => {
    const prompts = new PromptHarness({
      passwords: ["client-secret"],
      selects: ["__save"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({ [EXAMPLE_PATH]: MINIMAL_TEMPLATE });

    await runConfigTui(
      {},
      {
        prompts,
        fileSystem,
        repositoryRoot: REPOSITORY_ROOT,
        discoverAccounts: vi.fn().mockRejectedValue(new Error("logged out")),
        language: "en",
      },
    );

    expect(prompts.notes).toContainEqual(
      expect.objectContaining({ title: "Cloudflare account" }),
    );
  });

  it("does not save an invalid existing configuration", async () => {
    const prompts = new PromptHarness({
      selects: ["__save", "__cancel"],
    });
    const fileSystem = createFileSystem({
      [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
      [CONFIG_PATH]: '{ "$schema": "schemas/config-schema.json" }',
    });

    await expect(
      runConfigTui({}, dependencies(prompts, fileSystem)),
    ).resolves.toBe("cancelled");

    expect(fileSystem.writes).toHaveLength(0);
    expect(prompts.notes).toContainEqual(
      expect.objectContaining({ title: "Configuration needs attention" }),
    );
  });

  it.each([
    {
      name: "required first value",
      prompts: { passwords: [CANCEL] },
      files: { [EXAMPLE_PATH]: MINIMAL_TEMPLATE },
    },
    {
      name: "required first value with Esc",
      prompts: { passwords: [CONFIG_TUI_BACK] },
      files: { [EXAMPLE_PATH]: MINIMAL_TEMPLATE },
    },
    {
      name: "initial account choice",
      prompts: {
        passwords: ["proxy"],
        selects: [CANCEL],
      },
      files: { [EXAMPLE_PATH]: MINIMAL_TEMPLATE },
      accounts: [
        { id: "one", name: "One" },
        { id: "two", name: "Two" },
      ],
    },
    {
      name: "main menu",
      prompts: { selects: [CONFIG_TUI_BACK] },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
    {
      name: "existing initial account choice",
      prompts: { selects: [CANCEL] },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
      accounts: [
        { id: "one", name: "One" },
        { id: "two", name: "Two" },
      ],
    },
    {
      name: "group menu",
      prompts: { selects: ["authentication", CANCEL] },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
    {
      name: "provider menu",
      prompts: { selects: ["__providers", CANCEL] },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
    {
      name: "provider field action",
      prompts: {
        selects: ["__providers", "openai", "OPENAI_API_KEY", CANCEL],
      },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
    {
      name: "provider field menu",
      prompts: {
        selects: ["__providers", "openai", CANCEL],
      },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
    {
      name: "field action",
      prompts: {
        selects: ["authentication", "PROXY_API_KEY", CANCEL],
      },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
    {
      name: "field input",
      prompts: {
        selects: ["authentication", "PROXY_API_KEY", "change"],
        passwords: [CANCEL],
      },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
    {
      name: "boolean field input",
      prompts: {
        selects: [
          "behavior",
          "CHAT_RESPONSE_METADATA_ENABLED",
          "change",
          CANCEL,
        ],
      },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
    {
      name: "save confirmation",
      prompts: { selects: ["__save"], confirms: [CANCEL] },
      files: {
        [EXAMPLE_PATH]: MINIMAL_TEMPLATE,
        [CONFIG_PATH]: MINIMAL_TEMPLATE,
      },
    },
  ])(
    "cancels safely from the $name prompt",
    async ({ prompts, files, accounts }) => {
      const harness = new PromptHarness(prompts);
      const fileSystem = createFileSystem(files as Record<string, string>);

      await expect(
        runConfigTui({}, dependencies(harness, fileSystem, accounts)),
      ).resolves.toBe("cancelled");
      expect(fileSystem.writes).toHaveLength(0);
      expect(harness.cancellations).toHaveLength(1);
    },
  );

  it("requires the tracked example template", async () => {
    const prompts = new PromptHarness({});
    const fileSystem = createFileSystem({});

    await expect(
      runConfigTui({}, dependencies(prompts, fileSystem)),
    ).rejects.toThrow("config.example.jsonc was not found");
  });
});

describe("configuration parsing and validation", () => {
  it("classifies every supported schema property in exactly one TUI section", () => {
    const configuredFields = [
      ...FIELD_GROUPS.flatMap((group) => group.fields),
      ...PROVIDER_GROUPS.flatMap((provider) =>
        provider.fields.map((field) => field.key),
      ),
    ];
    const schemaFields = Object.keys(configSchema.properties).filter(
      (field) =>
        field !== "$schema" && !TUI_EXCLUDED_FIELDS.has(field as FieldKey),
    );

    expect(configuredFields).toHaveLength(new Set(configuredFields).size);
    expect([...configuredFields].sort()).toEqual(schemaFields.sort());
    expect(TUI_EXCLUDED_FIELDS).toEqual(new Set(["DEV"]));
  });

  it("parses JSONC and rejects malformed or non-object input", () => {
    expect(parseConfigSource('{ /* comment */ "value": 1, }')).toEqual({
      value: 1,
    });
    expect(() => parseConfigSource("{")).toThrow("not valid JSONC");
    expect(() => parseConfigSource("[]")).toThrow("not valid JSONC");
    expect(() => parseConfigSource("null")).toThrow("not valid JSONC");
  });

  it.each(["responsesPath", "messagesPath"])(
    "validates custom %s in the configuration schema",
    (field) => {
      const config = (path: unknown) => ({
        $schema: "schemas/config-schema.json",
        PROXY_API_KEY: "example-proxy-key",
        CUSTOM_OPENAI_ENDPOINTS: [
          { name: "custom", baseUrl: "https://example.com/v1", [field]: path },
        ],
      });
      expect(validateConfig(config("/native/api"))).toEqual([]);
      for (const path of [
        null,
        42,
        "",
        "relative",
        "//other.example/api",
        `/${"x".repeat(2048)}`,
      ]) {
        expect(validateConfig(config(path)).length).toBeGreaterThan(0);
      }
    },
  );

  it("validates complete configuration and safe field input without disclosing values", () => {
    expect(
      validateConfig({
        $schema: "schemas/config-schema.json",
        PROXY_API_KEY: "proxy",
      }),
    ).toEqual([]);
    expect(validateConfig({ EXTRA: "value" }).length).toBeGreaterThan(0);

    expect(validateConfigFieldInput("CLOUDFLARE_ACCOUNT_ID", "")).toBe(
      "Enter a value.",
    );
    expect(
      validateConfigFieldInput("CLOUDFLARE_ACCOUNT_ID", "invalid/account"),
    ).toContain("pattern");
    expect(
      validateConfigFieldInput(
        "CLOUDFLARE_ACCOUNT_ID",
        "invalid/account",
        "ja",
      ),
    ).toContain("指定された形式に一致しません");
    expect(validateConfigFieldInput("ALLOWED_ORIGINS", "not-json")).toBe(
      "Enter valid JSON.",
    );
    expect(
      validateConfigFieldInput(
        "ALLOWED_ORIGINS",
        '["https://console.example.com"]',
      ),
    ).toBeUndefined();
    expect(
      validateConfigFieldInput("API_KEY_COOLDOWN_SECONDS", "12"),
    ).toBeUndefined();
    expect(
      validateConfigFieldInput("OPENAI_API_KEY", '{"default":["key"]}'),
    ).toBeUndefined();
    expect(
      validateConfigFieldInput("OPENAI_API_KEY", "{opaque-provider-key"),
    ).toBeUndefined();

    expect(validateConfig({ EXTRA: "value" }, "ja")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("未対応の設定項目です"),
        expect.stringContaining("必須項目です"),
      ]),
    );
    expect(
      validateConfig(
        {
          $schema: "schemas/config-schema.json",
          PROXY_API_KEY: "",
        },
        "ja",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("設定値が正しくありません"),
      ]),
    );
  });
});

describe("Esc key mapping", () => {
  it("maps an Esc cancellation to one-level-back", async () => {
    const input = new PassThrough();
    const result = await mapEscapeToBack(
      async () => {
        input.emit("keypress", "", { name: "escape" });
        return CANCEL;
      },
      input,
      (value) => value === CANCEL,
    );

    expect(result).toBe(CONFIG_TUI_BACK);
    expect(input.listenerCount("keypress")).toBe(0);
  });

  it("leaves Ctrl+C cancellation and submitted values unchanged", async () => {
    const input = new PassThrough();
    await expect(
      mapEscapeToBack(
        async () => CANCEL,
        input,
        (value) => value === CANCEL,
      ),
    ).resolves.toBe(CANCEL);
    await expect(
      mapEscapeToBack(
        async () => {
          input.emit("keypress", "", { name: "return" });
          return "value";
        },
        input,
        (value) => value === CANCEL,
      ),
    ).resolves.toBe("value");
  });
});

describe("Wrangler account discovery", () => {
  it("runs whoami in JSON mode and keeps only well-formed accounts", async () => {
    const execute = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        loggedIn: true,
        accounts: [
          { id: "one", name: "First" },
          null,
          "bad",
          { id: 2, name: "Bad ID" },
          { id: "two", name: 2 },
        ],
      }),
      stderr: "",
    });

    await expect(discoverCloudflareAccounts(execute)).resolves.toEqual([
      { id: "one", name: "First" },
    ]);
    expect(execute).toHaveBeenCalledWith(
      "wrangler",
      ["whoami", "--json"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it.each([
    { loggedIn: false, accounts: [] },
    { loggedIn: true, accounts: null },
  ])("rejects an unexpected identity response", async (response) => {
    const execute = vi.fn().mockResolvedValue({
      stdout: JSON.stringify(response),
      stderr: "",
    });
    await expect(discoverCloudflareAccounts(execute)).rejects.toThrow(
      "unexpected identity response",
    );
  });
});

describe("configuration TUI command line", () => {
  it("parses default and named paths", () => {
    expect(parseConfigTuiArguments([])).toEqual({
      env: undefined,
      help: undefined,
    });
    expect(parseConfigTuiArguments(["--env", "production", "-h"])).toEqual({
      env: "production",
      help: true,
    });
    expect(getConfigTuiPath(REPOSITORY_ROOT)).toBe(CONFIG_PATH);
    expect(getConfigTuiPath(REPOSITORY_ROOT, "production")).toBe(
      `${REPOSITORY_ROOT}/config.production.jsonc`,
    );
    expect(configTuiHelp()).toContain("Create or edit");

    const originalArguments = process.argv;
    process.argv = ["node", "create-config.ts"];
    try {
      expect(parseConfigTuiArguments()).toEqual({
        env: undefined,
        help: undefined,
      });
    } finally {
      process.argv = originalArguments;
    }
  });

  it("rejects unsafe environment names", () => {
    expect(() => parseConfigTuiArguments(["--env", "../prod"])).toThrow(
      "Environment name",
    );
  });

  it("prints help without opening the TUI", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runCreateConfigCli(["--help"])).resolves.toBe("help");
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining("Usage: secrets"),
    );
  });

  it("runs the non-help command with injected terminal dependencies", async () => {
    const prompts = new PromptHarness({
      passwords: ["proxy"],
      selects: ["__save"],
      confirms: [true],
    });
    const fileSystem = createFileSystem({ [EXAMPLE_PATH]: MINIMAL_TEMPLATE });

    await expect(
      runCreateConfigCli([], dependencies(prompts, fileSystem)),
    ).resolves.toBe("saved");
  });

  it("uses process arguments when the command argument list is omitted", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalArguments = process.argv;
    process.argv = ["node", "create-config.ts", "--help"];
    try {
      await expect(runCreateConfigCli()).resolves.toBe("help");
    } finally {
      process.argv = originalArguments;
    }
    expect(consoleLog).toHaveBeenCalled();
  });
});
