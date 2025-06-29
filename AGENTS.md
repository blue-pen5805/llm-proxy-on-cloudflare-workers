# LLM Proxy on Cloudflare Workers

## Project Overview

Serverless LLM proxy running on Cloudflare Workers, providing centralized API key management and OpenAI-compatible endpoints for multiple LLM providers.

## Key Architecture

- **Runtime**: Cloudflare Workers (Edge computing)
- **Language**: TypeScript with strict type checking
- **Entry point**: `src/index.ts`
- **Config**: `config.jsonc` (use `config.jsonc.example` as template)
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers`

## Essential Commands

```bash
npm run dev         # Start local development server
npm run test        # Run test suite
npm run lint        # Run linter
npm run prettier-ci # Run formatter
```

## Configuration

- Copy `config.example.jsonc` to `config.jsonc` for local development
- Environment variables managed through `src/utils/config.ts`
- **IMPORTANT**: Never commit real API keys to git

## Development Workflow

1. **Explore**: Read relevant files before making changes
2. **Test**: Write tests before implementing code
3. **Code**: Follow TypeScript strict mode
4. **Verify**: Run tests, linting and formatting checks

## Code Style Guidelines

- **TypeScript**: Strict mode, target ES2022
- **Imports**: ES modules with destructuring
- **Async**: Prefer async/await over Promise chains
- **Functions**: Arrow functions for callbacks, regular functions for top-level
- **Objects**: Use spread syntax (`{...obj}`) over `Object.assign()`

## Naming Conventions

- **Files**: snake-case for all file names
- **Directories**: snake-case for folder names
- **Variables/Functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Types/Interfaces**: PascalCase
- **Enums**: PascalCase with descriptive prefix
- **Classes**: PascalCase

## Comment Guidelines

- **Language**: English only, be concise
- **Use sparingly**: Only when necessary for clarity
- **Focus on**: Complex logic, workarounds, differences
- **Avoid**: Self-explanatory code, type info (TypeScript handles this)

## Documentation Guidelines

- **Format**: Markdown files in `docs/`
- **Language**: English for main documentation, Japanese translations with `_ja.md` suffix (both languages required)
- **Structure**: Use headings, bullet points, code blocks
- **Simplicity**: Keep it clear and concise
- **Examples**: Include code snippets for complex concepts
