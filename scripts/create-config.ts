#!/usr/bin/env ts-node
import { readFileSync, writeFileSync, existsSync } from "fs";
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
  "CF_AIG_TOKEN",
  "CUSTOM_OPENAI_ENDPOINTS",
  "DEV",
  "DEFAULT_MODEL",
  "ENABLE_GLOBAL_ROUND_ROBIN",
];

// Configuration: Fields that require at least one to be set
const API_KEY_FIELDS_GROUP = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "COHERE_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROK_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
  "HUGGINGFACE_API_KEY",
  "PERPLEXITYAI_API_KEY",
  "REPLICATE_API_KEY",
  "CLOUDFLARE_API_KEY",
  "OLLAMA_API_KEY",
];

interface ConfigValue {
  key: string;
  value: any;
  comment?: string;
}

function createReadlineInterface(): Interface {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

function parseJsoncFile(content: string): {
  config: Record<string, any>;
  structure: ConfigValue[];
} {
  if (!content || typeof content !== "string") {
    throw new Error("Invalid content provided to parseJsoncFile");
  }

  const lines = content.split("\n");
  const structure: ConfigValue[] = [];
  const comments: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("//")) {
      const comment = trimmed.substring(2).trim();
      comments.push(comment);
      continue;
    }

    const match = trimmed.match(/^"([^"]+)":\s*(.+?),?$/);
    if (match) {
      const [, key, valueStr] = match;
      let value;

      try {
        const cleanValueStr = valueStr.replace(/,$/, "");
        value = JSON.parse(cleanValueStr);
      } catch {
        value = valueStr.replace(/^"|"$/g, "").replace(/,$/, "");
      }

      const relevantComment =
        comments.length > 0 ? comments[comments.length - 1] : undefined;

      structure.push({
        key,
        value,
        comment: relevantComment,
      });

      comments.length = 0;
    }
  }

  const config: Record<string, any> = {};
  for (const item of structure) {
    config[item.key] = item.value;
  }

  return { config, structure };
}

function getFieldDescription(key: string, comment?: string): string {
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
  rl: Interface,
  key: string,
  description: string,
  isRequired: boolean = false,
  currentValue?: any,
): Promise<any> {
  const requiredText = isRequired
    ? " (required)"
    : " (optional, press Enter to skip)";
  const currentText =
    currentValue !== null && currentValue !== undefined
      ? ` [current: ${JSON.stringify(currentValue)}]`
      : "";
  const prompt = `${description}${currentText}${requiredText}: `;

  let value: string;
  do {
    value = await question(rl, prompt);
    if (isRequired && !value.trim()) {
      console.log("This field is required. Please enter a value.");
    }
  } while (isRequired && !value.trim());

  if (!value.trim()) {
    return null; // Return null for empty input instead of currentValue
  }

  // Try to parse as JSON, otherwise return as string
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function reconstructJsonc(
  structure: ConfigValue[],
  config: Record<string, any>,
): string {
  let result = '{\n  "$schema": "schemas/config-schema.json",\n\n';

  let currentSection = "";

  for (const item of structure) {
    if (IGNORED_FIELDS.includes(item.key)) {
      continue;
    }

    // Skip null values (empty inputs)
    const value = config[item.key];
    if (value === null || value === undefined) {
      continue;
    }

    // Add section headers based on comments
    if (item.comment && item.comment.includes("---")) {
      if (currentSection) {
        result += "\n";
      }
      result += `  // ${item.comment}\n`;
      currentSection = item.comment;
    } else if (item.comment && !item.comment.includes("---")) {
      result += `  // ${item.comment}\n`;
    }

    // Add the key-value pair
    result += `  "${item.key}": ${JSON.stringify(value)},\n`;
  }

  // Remove trailing comma and close
  result = result.replace(/,\n$/, "\n");
  result += "}";

  return result;
}

async function main(): Promise<void> {
  console.log("🚀 Config.jsonc Creation Tool\n");

  if (existsSync(CONFIG_OUTPUT_PATH)) {
    const rl = createReadlineInterface();
    const overwrite = await question(
      rl,
      `${CONFIG_OUTPUT_PATH} already exists. Overwrite? (y/N): `,
    );
    rl.close();

    if (overwrite.toLowerCase() !== "y" && overwrite.toLowerCase() !== "yes") {
      console.log("Cancelled.");
      process.exit(0);
      return; // Add return to prevent further execution in tests
    }
  }

  if (!existsSync(CONFIG_EXAMPLE_PATH)) {
    console.error(`Error: ${CONFIG_EXAMPLE_PATH} not found.`);
    process.exit(1);
    return; // Add return to prevent further execution in tests
  }

  const exampleContent = readFileSync(CONFIG_EXAMPLE_PATH, "utf8");
  const { config, structure } = parseJsoncFile(exampleContent);

  const rl = createReadlineInterface();

  try {
    console.log(
      "Starting configuration setup. Please enter values for each field.\n",
    );

    // Process all fields from the structure
    for (const item of structure) {
      if (IGNORED_FIELDS.includes(item.key)) {
        continue;
      }

      const isRequired = REQUIRED_FIELDS.includes(item.key);
      const description = getFieldDescription(item.key, item.comment);

      config[item.key] = await promptForValue(
        rl,
        item.key,
        description,
        isRequired,
        config[item.key],
      );
    }

    // Check if at least one API key is provided
    const hasApiKey = API_KEY_FIELDS_GROUP.some((key) => {
      const value = config[key];
      return value !== null && value !== undefined && value !== "";
    });

    if (!hasApiKey) {
      console.log(
        "\nWarning: No API keys configured. At least one provider API key is recommended.",
      );
    }

    const configContent = reconstructJsonc(structure, config);
    writeFileSync(CONFIG_OUTPUT_PATH, configContent);

    console.log(`\n✅ ${CONFIG_OUTPUT_PATH} created successfully!`);
    console.log("\nNext steps:");
    console.log("1. Run 'npm run deploy' to deploy to Cloudflare Workers");
    console.log(
      "2. Run 'npm run secrets:deploy' to register API keys as secrets",
    );
  } catch (error) {
    console.error(
      "\nAn error occurred:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
    return; // Add return to prevent further execution in tests
  } finally {
    rl.close();
  }
}

export { main };

// Run main function if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
