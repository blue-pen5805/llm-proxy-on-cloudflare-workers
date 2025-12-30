import { OpenAICompatibleProvider } from "../provider";

export class OpenAI extends OpenAICompatibleProvider {
  readonly apiKeyName: keyof Env = "OPENAI_API_KEY";
  readonly baseUrlProp: string = "https://api.openai.com/v1";
}
