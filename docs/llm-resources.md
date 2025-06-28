# LLM Resources

This document describes the LLM (Large Language Model) resources used in this project. These resources contain lists of supported LLM models and are managed through automated download scripts.

## Overview

The project maintains up-to-date LLM model information by downloading resource files from external sources. These files are stored in the `.llm_resources/` directory and contain comprehensive lists of available models from various providers.

## Updating Resources

### Prerequisites

Ensure the project dependencies are installed:

```bash
npm install
```

### Download Process

1. **Download latest LLM resources**:

```bash
npm run download-llm-resources
```

2. **Verify updates**:

Check the `.llm_resources/` directory to confirm files have been updated.

### Configuration

To modify resource URLs, edit `.llm_resources/urls.yaml`:
