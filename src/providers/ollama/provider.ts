import { OpenAICompatibleProvider } from "../provider";

export class Ollama extends OpenAICompatibleProvider {
  readonly apiKeyName: keyof Env = "OLLAMA_API_KEY";
  readonly baseUrlProp: string = "https://ollama.com/v1";
}
