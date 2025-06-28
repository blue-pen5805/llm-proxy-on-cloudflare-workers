# Dependencies

This document describes the project dependencies and their management. The project uses npm packages for various functionalities including TypeScript compilation, testing, and Cloudflare Workers integration.

## Overview

The project maintains its dependencies through `package.json` and uses automated tools to keep packages up-to-date. Dependencies include development tools, runtime libraries, and Cloudflare-specific packages that enable the LLM proxy functionality.

## Updating Dependencies

### Prerequisites

Install `npm-check-updates` globally:

```bash
npm install -g npm-check-updates
```

Or use `npx` for a single use.

### Update Process

1. **Update `package.json`**:

```bash
ncu -u
```

2. **Install new packages**:

```bash
npm install
```

3. **Update Cloudflare Worker types**:

```bash
npm run cf-typegen
```

4. **Run tests**:

```bash
npm run test
```

If tests fail, debug the breaking changes.
