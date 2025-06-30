import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface UrlsConfig {
  resources: string[];
}

function stripJsonComments(jsonString: string): string {
  const lines = jsonString.split("\n");
  const cleanedLines = lines.map((line) => {
    // Find the position of '//' that's not inside a string
    let inString = false;
    let stringChar = "";
    let commentIndex = -1;

    for (let i = 0; i < line.length - 1; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && line[i - 1] !== "\\") {
        inString = false;
        stringChar = "";
      } else if (!inString && char === "/" && nextChar === "/") {
        commentIndex = i;
        break;
      }
    }

    if (commentIndex >= 0) {
      return line.substring(0, commentIndex).trim();
    }
    return line;
  });

  // Join lines and remove multi-line comments
  let result = cleanedLines.join("\n");
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove trailing commas before closing brackets/braces
  result = result.replace(/,(\s*[}\]])/g, "$1");

  return result;
}

async function downloadFile(url: string, filePath: string): Promise<boolean> {
  try {
    console.log(`Downloading: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const content = await response.text();

    // Create directory if it doesn't exist
    mkdirSync(dirname(filePath), { recursive: true });

    // Write file
    writeFileSync(filePath, content, "utf8");

    console.log(`✓ Downloaded to: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to download ${url}:`, error);

    // Remove file if it exists and failed
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }

    return false;
  }
}

function extractPathFromUrl(url: string): string {
  // Remove protocol (http:// or https://)
  return url.replace(/^https?:\/\//, "");
}

async function main() {
  const baseDir = ".llm_resources";
  const urlFile = join(baseDir, "urls.jsonc");

  // Check if urls.jsonc exists
  if (!existsSync(urlFile)) {
    console.error(`Error: ${urlFile} not found.`);
    process.exit(1);
  }

  try {
    // Read and parse URLs from JSONC file
    const configContent = readFileSync(urlFile, "utf8");
    const cleanedJson = stripJsonComments(configContent);
    const config: UrlsConfig = JSON.parse(cleanedJson);

    if (!config.resources || !Array.isArray(config.resources)) {
      console.error(
        'Error: Invalid JSON structure. Expected "resources" array.',
      );
      process.exit(1);
    }

    let successCount = 0;
    let totalCount = 0;

    // Download each URL
    for (const url of config.resources) {
      if (!url || typeof url !== "string") {
        console.warn("Skipping empty or invalid URL");
        continue;
      }

      totalCount++;
      const path = extractPathFromUrl(url);
      const filePath = join(baseDir, path);

      const success = await downloadFile(url, filePath);
      if (success) {
        successCount++;
      }
    }

    console.log(
      `\nDownloads complete. ${successCount}/${totalCount} files downloaded successfully.`,
    );

    if (successCount < totalCount) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Error reading or parsing URLs file:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
