#!/usr/bin/env tsx
import { getErrorMessage } from "./utils.ts";
import { chmodSync, readFileSync, writeFileSync, existsSync } from "fs";
import { createInterface, Interface } from "readline";

const CONFIG_EXAMPLE_PATH = "config.example.jsonc";
const CONFIG_OUTPUT_PATH = "config.jsonc";

// Configuration: Required fields (must be provided by user)
const REQUIRED_FIELDS = ["PROXY_API_KEY"];

// Configuration: Fields to ignore (won't be prompted for)
const IGNORED_FIELDS = [
  "$schema",
  "CLOUDFLARE_ACCOUNT_ID",
  "AI_GATEWAY_NAME",
  "ALWAYS_USE_AI_GATEWAY",
  "CF_AIG_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CUSTOM_OPENAI_ENDPOINTS",
  "DEV",
  "DEFAULT_MODEL",
  "CHAT_RESPONSE_METADATA_ENABLED",
  "API_KEY_COOLDOWN_SECONDS",
  "MODELS_CACHE_TTL_SECONDS",
];

// Configuration: Fields that require at least one to be set
const API_KEY_FIELDS_GROUP = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "COHERE_API_KEY",
  "CLINE_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROK_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_NIM_API_KEY",
  "OPENROUTER_API_KEY",
  "HUGGINGFACE_API_KEY",
  "PERPLEXITYAI_API_KEY",
  "REPLICATE_API_KEY",
  "CLOUDFLARE_API_KEY",
  "OLLAMA_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON",
  "AWS_BEARER_TOKEN_BEDROCK",
];

interface ConfigField {
  key: string;
  value: unknown;
  comment?: string;
}

function createReadlineInterface(): Interface {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function askQuestion(
  readlineInterface: Interface,
  promptText: string,
): Promise<string> {
  return new Promise((resolve) => {
    readlineInterface.question(promptText, (answer) => {
      resolve(answer);
    });
  });
}

export function parseConfigTemplate(jsoncText: string): {
  config: Record<string, unknown>;
  structure: ConfigField[];
} {
  if (!jsoncText || typeof jsoncText !== "string") {
    throw new Error("Invalid content provided to parseConfigTemplate");
  }

  const sourceLines = jsoncText.split("\n");
  const configFields: ConfigField[] = [];
  const pendingComments: string[] = [];

  for (const sourceLine of sourceLines) {
    const trimmedLine = sourceLine.trim();

    if (trimmedLine.startsWith("//")) {
      const commentText = trimmedLine.substring(2).trim();
      pendingComments.push(commentText);
      continue;
    }

    const propertyMatch = trimmedLine.match(/^"([^"]+)":\s*(.+?),?$/);
    if (propertyMatch) {
      const [, fieldName, serializedValue] = propertyMatch;
      let parsedValue: unknown;

      try {
        const valueWithoutTrailingComma = serializedValue.replace(/,$/, "");
        parsedValue = JSON.parse(valueWithoutTrailingComma);
      } catch {
        parsedValue = serializedValue.replace(/^"|"$/g, "").replace(/,$/, "");
      }

      const relevantComment =
        pendingComments.length > 0
          ? pendingComments[pendingComments.length - 1]
          : undefined;

      configFields.push({
        key: fieldName,
        value: parsedValue,
        comment: relevantComment,
      });

      pendingComments.length = 0;
    }
  }

  const config: Record<string, unknown> = {};
  for (const configField of configFields) {
    config[configField.key] = configField.value;
  }

  return { config, structure: configFields };
}

export function getFieldDescription(key: string, comment?: string): string {
  if (comment && !comment.includes("---")) {
    return comment;
  }

  // Fallback descriptions based on key patterns
  if (key.includes("API_KEY")) {
    return `API key for ${key.replace("_API_KEY", "").toLowerCase()}`;
  }

  return key.replace(/_/g, " ").toLowerCase();
}

async function promptForValue(
  readlineInterface: Interface,
  description: string,
  isRequired: boolean,
  currentValue?: unknown,
): Promise<unknown> {
  const requiredText = isRequired
    ? " (required)"
    : " (optional, press Enter to skip)";
  const currentText =
    currentValue !== null && currentValue !== undefined
      ? ` [current: ${JSON.stringify(currentValue)}]`
      : "";
  const promptText = `${description}${currentText}${requiredText}: `;

  let enteredValue: string;
  do {
    enteredValue = await askQuestion(readlineInterface, promptText);
    if (isRequired && !enteredValue.trim()) {
      console.log("This field is required. Please enter a value.");
    }
  } while (isRequired && !enteredValue.trim());

  if (!enteredValue.trim()) {
    return null; // Return null for empty input instead of currentValue
  }

  // Try to parse as JSON, otherwise return as string
  try {
    return JSON.parse(enteredValue);
  } catch {
    return enteredValue;
  }
}

export function serializeConfigJsonc(
  configFields: ConfigField[],
  config: Record<string, unknown>,
): string {
  let jsoncOutput = '{\n  "$schema": "schemas/config-schema.json",\n\n';

  let currentSection = "";

  for (const configField of configFields) {
    if (IGNORED_FIELDS.includes(configField.key)) {
      continue;
    }

    // Skip null values (empty inputs)
    const configuredValue = config[configField.key];
    if (configuredValue === null || configuredValue === undefined) {
      continue;
    }

    // Add section headers based on comments
    if (configField.comment && configField.comment.includes("---")) {
      if (currentSection) {
        jsoncOutput += "\n";
      }
      jsoncOutput += `  // ${configField.comment}\n`;
      currentSection = configField.comment;
    } else if (configField.comment && !configField.comment.includes("---")) {
      jsoncOutput += `  // ${configField.comment}\n`;
    }

    // Add the key-value pair
    jsoncOutput += `  "${configField.key}": ${JSON.stringify(configuredValue)},\n`;
  }

  // Remove trailing comma and close
  jsoncOutput = jsoncOutput.replace(/,\n$/, "\n");
  jsoncOutput += "}";

  return jsoncOutput;
}

async function runCreateConfigCli(): Promise<void> {
  console.log("🚀 Config.jsonc Creation Tool\n");

  if (existsSync(CONFIG_OUTPUT_PATH)) {
    const overwritePrompt = createReadlineInterface();
    const overwriteAnswer = await askQuestion(
      overwritePrompt,
      `${CONFIG_OUTPUT_PATH} already exists. Overwrite? (y/N): `,
    );
    overwritePrompt.close();

    if (!["y", "yes"].includes(overwriteAnswer.toLowerCase())) {
      console.log("Cancelled.");
      process.exit(0);
      return;
    }
  }

  if (!existsSync(CONFIG_EXAMPLE_PATH)) {
    console.error(`Error: ${CONFIG_EXAMPLE_PATH} not found.`);
    process.exit(1);
    return;
  }

  const exampleConfigText = readFileSync(CONFIG_EXAMPLE_PATH, "utf8");
  const { config, structure: configFields } =
    parseConfigTemplate(exampleConfigText);

  const configurationPrompt = createReadlineInterface();

  try {
    console.log(
      "Starting configuration setup. Please enter values for each field.\n",
    );

    // Process all fields from the structure
    for (const configField of configFields) {
      if (IGNORED_FIELDS.includes(configField.key)) {
        continue;
      }

      const isRequired = REQUIRED_FIELDS.includes(configField.key);
      const description = getFieldDescription(
        configField.key,
        configField.comment,
      );

      config[configField.key] = await promptForValue(
        configurationPrompt,
        description,
        isRequired,
        config[configField.key],
      );
    }

    // Check if at least one API key is provided
    const hasConfiguredProviderKey = API_KEY_FIELDS_GROUP.some((fieldName) => {
      const configuredValue = config[fieldName];
      return (
        configuredValue !== null &&
        configuredValue !== undefined &&
        configuredValue !== ""
      );
    });

    if (!hasConfiguredProviderKey) {
      console.log(
        "\nWarning: No API keys configured. At least one provider API key is recommended.",
      );
    }

    const generatedConfigText = serializeConfigJsonc(configFields, config);
    writeFileSync(CONFIG_OUTPUT_PATH, generatedConfigText, { mode: 0o600 });
    chmodSync(CONFIG_OUTPUT_PATH, 0o600);

    console.log(`\n✅ ${CONFIG_OUTPUT_PATH} created successfully!`);
    console.log("\nNext steps:");
    console.log("1. Run 'npm run deploy' to deploy to Cloudflare Workers");
    console.log(
      "2. Run 'npm run secrets:deploy' to register API keys as secrets",
    );
  } catch (error) {
    console.error("\nAn error occurred:", getErrorMessage(error));
    process.exit(1);
    return;
  } finally {
    configurationPrompt.close();
  }
}

export { runCreateConfigCli };

// Run the CLI only when this script is executed directly.
/* istanbul ignore next -- exercised by the runtime, not module tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  void runCreateConfigCli().catch(console.error);
}
