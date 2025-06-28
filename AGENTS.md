# LLM Proxy on Cloudflare Workers

This project is an LLM (Large Language Model) proxy server running on Cloudflare Workers.

## Project Overview

**LLM Proxy on Cloudflare Workers** is a serverless proxy that integrates multiple LLM APIs, providing centralized API key management and OpenAI-compatible endpoints.

### Key Features

- Centralized API key management
- Pass-through endpoints (direct API forwarding for each provider)
- OpenAI-compatible endpoints (`/v1/chat/completions`, `/v1/models`)
- Cloudflare AI Gateway integration

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Testing**: Vitest
- **Deployment**: Wrangler CLI

This project provides a lightweight proxy server that can handle multiple LLM providers in a unified way, designed to help developers efficiently utilize LLM APIs.

## Project Structure

```
├── src/                   # Main source code
├── test/                  # Test files
├── docs/                  # Documentation
│   ├── dependencies.md    # Dependency management
│   └── llm-resources.md   # LLM resource management
└── .llm_resources/        # LLM resource files
    ├── ../                # LLM friendly documentation
    ├── download.sh        # LLM resource download script
    └── urls.yaml          # Download target URL configuration
```

### Key Commands

```bash
# Start development server
npm run dev

# Run tests
npm run test

# Update LLM resources
npm run download-llm-resources

# Deploy
npm run deploy
```

## Coding Style

The project follows TypeScript best practices and maintains consistent code formatting:

- **TypeScript**: Strict type checking enabled
- **Formatting**: Prettier for consistent code style
- **File Structure**: Modular approach with clear separation of concerns
- **Naming**: Descriptive variable and function names
- **Error Handling**: Proper error propagation and handling

### Code Formatting Commands

```bash
# Format specific files
npm run prettier <file1> <file2> ...
```

## Testing

The project uses Vitest with Cloudflare Workers-specific testing utilities:

- **Test Framework**: Vitest
- **Test Structure**: Mirror source structure in `test/` directory

### Testing Commands

```bash
# Run tests
npm run test
```

## LLM Documentation

### `.llm_resources/` Folder

- Latest LLM model information resources
- Cloudflare developer documentation
- Automated download script (`download.sh`)

### `docs/` Folder

- **dependencies.md**: npm dependency management guide
- **llm-resources.md**: LLM resource update procedures
