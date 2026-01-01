import { OpenAICompatibleProvider } from "../provider";

export class Grok extends OpenAICompatibleProvider {
  get chatCompletionPath(): string {
    return "/v1/chat/completions";
  }
  get modelsPath(): string {
    return "/v1/models";
  }

  readonly apiKeyName: keyof Env = "GROK_API_KEY";
  readonly baseUrlProp: string = "https://api.x.ai";
}
