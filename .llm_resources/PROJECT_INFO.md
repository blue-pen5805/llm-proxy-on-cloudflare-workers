# Project Information

## Project Overview

Serverless LLM proxy running on Cloudflare Workers, providing centralized API key management and OpenAI-compatible endpoints for multiple LLM providers.

## Key Architecture

- **Runtime**: Cloudflare Workers (Edge computing)
- **Language**: TypeScript with strict type checking
- **Entry point**: `src/index.ts`
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers`

## Essential Commands

```bash
npm run dev         # Start local development server
npm run test        # Run test suite
npm run test-watch  # Run test suite in watch mode
npm run lint        # Run linter
npm run lint:fix    # Run linter with auto-fix
npm run prettier-ci # Run formatter check
npm run prettier    # Run formatter
npm run deploy      # Deploy to Cloudflare Workers
npm run cf-typegen  # Generate Cloudflare Worker types
```
