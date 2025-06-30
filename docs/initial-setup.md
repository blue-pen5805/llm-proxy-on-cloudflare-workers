# Initial Setup Guide

This guide explains the initial setup process for `cloudflare-workers-llm-proxy`.

## Prerequisites

- [Node.js](https://nodejs.org/) (v22.12 or later) and npm are installed.
- You have a [Cloudflare](https://www.cloudflare.com/) account.

## 1. Clone the Project and Install Dependencies

First, clone the project to your local machine and install the necessary dependencies.

```bash
# Clone the project
git clone https://github.com/your-username/cloudflare-workers-llm-proxy.git

# Change to the project directory
cd cloudflare-workers-llm-proxy

# Install dependencies
npm install
```

## 2. Authenticate with Cloudflare

Before you can deploy to Cloudflare Workers, you need to authenticate with your Cloudflare account using `wrangler`.

```bash
# Login to your Cloudflare account
npm run cf:login
```

This command will open a browser window where you can log in to your Cloudflare account and authorize `wrangler` to manage your Workers.

## 3. Create the Configuration File

Create the configuration file using the provided script.

```bash
npm run secrets:create
```

This will create `config.jsonc` from the template and guide you through the configuration process. You need to configure at least one provider.

**Configuration Example (`config.jsonc`):**

```jsonc
{
  "$schema": "../schemas/config-schema.json",
  "PROXY_API_KEY": "your-proxy-api-key",
  "OPENAI_API_KEY": "sk-...",
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "GEMINI_API_KEY": ["YOUR_GEMINI_API_KEY_1", "YOUR_GEMINI_API_KEY_2"],
}
```

The `PROXY_API_KEY` is the API key to use this proxy. Set any string you like.
For the other `*_API_KEY` fields, set the actual API keys obtained from each provider. You can also specify multiple keys as an array, like `GEMINI_API_KEY`.

## 4. Deploy to Cloudflare Workers

Once the configuration is complete, deploy the project to Cloudflare Workers.

```bash
npm run deploy
```

This command executes `wrangler deploy`, which deploys the application with `src/index.ts` as the entry point. On the first deployment, a new Worker will be created with the `name` specified in `wrangler.jsonc`.

## 5. Deploy API Keys as Secrets

As a security best practice, API keys should be managed securely using Cloudflare's Secrets feature.

A script is provided to bulk-register the API keys from `config.jsonc` as Secrets.

```bash
# Deploy to the default environment
npm run secrets:deploy

# Deploy to the "production" environment (using config.production.jsonc)
npm run secrets:deploy -- --env production
```

**Important:**
If you change an `apiKey` in `config.jsonc` after deployment, you must run `npm run secrets:deploy` again to update the Secrets.

This completes the initial setup. You can now send OpenAI-compatible requests to your deployed Worker's endpoint.
