# Dependencies

This document describes the project dependencies and their management. The project uses npm packages for various functionalities including TypeScript compilation, testing, and Cloudflare Workers integration.

## Overview

The project maintains its dependencies through `package.json` and uses automated tools to keep packages up-to-date. Dependencies include development tools, runtime libraries, and Cloudflare-specific packages that enable the LLM proxy functionality.

The main dependencies are:

- **Wrangler**: For deploying and managing Cloudflare Workers.
- **Vitest**: For running tests.
- **TypeScript**: For type checking and compilation.
- **ESLint and Prettier**: For code linting and formatting.

## Updating Dependencies

### Prerequisites

Install `npm-check-updates` globally:

```bash
npm install -g npm-check-updates
```

Or use `npx` for a single use.

### Update Process

1. **Check for outdated packages**:

   ```bash
   ncu
   ```

2. **Update `package.json`**:

   ```bash
   ncu -u
   ```

3. **Install new packages**:

   ```bash
   npm install
   ```

4. **Update Cloudflare Worker types**:

   ```bash
   npm run cf-typegen
   ```

5. **Run tests**:
   ```bash
   npm run test
   ```

If tests fail, debug the breaking changes introduced by the updated packages.
