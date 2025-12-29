import { OpenAICompatibleProvider } from "../provider";

export class Grok extends OpenAICompatibleProvider {
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  readonly apiKeyName: keyof Env = "GROK_API_KEY";
  readonly baseUrlProp: string = "https://api.x.ai";
}
