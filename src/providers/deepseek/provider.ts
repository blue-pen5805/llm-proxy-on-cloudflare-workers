import { OpenAICompatibleProvider } from "../provider";

export class DeepSeek extends OpenAICompatibleProvider {
  readonly apiKeyName: keyof Env = "DEEPSEEK_API_KEY";
  readonly baseUrlProp: string = "https://api.deepseek.com";
}
