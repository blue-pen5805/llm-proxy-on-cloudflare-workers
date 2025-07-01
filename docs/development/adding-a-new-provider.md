# Adding a New Provider

This guide explains how to add a new LLM provider to the proxy.

## Directory Structure

Create a new directory for your provider under `src/providers`. For example, if you are adding a provider named "MyProvider", you would create the following directory:

```
src/providers/my-provider
```

Inside this directory, you will typically have the following files:

-   `index.ts`: Exports the provider module.
-   `provider.ts`: Implements the provider-specific logic.
-   `endpoint.ts`: Defines the provider-specific endpoint handlers.
-   `types.d.ts` (optional): Contains the provider-specific type definitions.

## Implementing the Endpoint

First, in `endpoint.ts`, create a class that extends `EndpointBase` from `src/providers/endpoint.ts`.

This class is responsible for handling the direct communication with the provider's API.

-   **`constructor(apikey: string)`**: Store the API key.
-   **`available()`**: Return `true` if the API key is present.
-   **`baseUrl()`**: Return the base URL for the provider's API.
-   **`headers()`**: Return an object with the necessary headers for authentication (e.g., `Authorization`, `x-api-key`).

## Implementing the Provider

Next, in `provider.ts`, create a class that extends `ProviderBase` from `src/providers/provider.ts`.

This class defines the provider's configuration and behavior within the proxy.

### Required Properties:

-   **`apiKeyName`**: The name of the environment variable that holds the API key (e.g., `"MY_PROVIDER_API_KEY"`).
-   **`chatCompletionPath`**: The path for the chat completions endpoint (e.g., `"/v1/chat/completions"`).
-   **`modelsPath`**: The path for the models list endpoint (e.g., `"/v1/models"`).

### Optional Method Override:

-   **`modelsToOpenAIFormat(data: any)`**: If the provider's model list format is different from OpenAI's, you must override this method to transform the data into the OpenAI format.

### Constructor

In the constructor, instantiate your new endpoint class, passing the API key from `Secrets.get(this.apiKeyName)`.

```typescript
import { Secrets } from "../../utils/secrets";
import { ProviderBase } from "../provider";
import { MyProviderEndpoint } from "./endpoint";

export class MyProvider extends ProviderBase {
  readonly apiKeyName: keyof Env = "MY_PROVIDER_API_KEY";
  readonly chatCompletionPath: string = "/v1/chat/completions";
  readonly modelsPath: string = "/v1/models";

  endpoint: MyProviderEndpoint;

  constructor() {
    super();
    this.endpoint = new MyProviderEndpoint(Secrets.get(this.apiKeyName));
  }
}
```

## Registering the Provider

Finally, you need to register your new provider in `src/providers.ts`.

Add your provider to the `PROVIDERS` object.

```typescript
import { MyProvider } from './providers/my-provider';

export const PROVIDERS = {
  // ... other providers
  'my-provider': MyProvider,
};
```

## Testing

Don't forget to add tests for your new provider! Create a new test file under `test/src/providers` and add tests for your provider's functionality.
