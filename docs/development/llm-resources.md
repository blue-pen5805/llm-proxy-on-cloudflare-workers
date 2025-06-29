# LLM Resources

This document describes the LLM (Large Language Model) resources used in this project. These resources contain lists of supported LLM models and are managed through automated download scripts.

## Overview

The project maintains up-to-date LLM model information by downloading resource files from external sources. These files are stored in the `.llm_resources/` directory and contain comprehensive lists of available models from various providers.

The download script (`./.llm_resources/download.sh`) reads a list of URLs from `.llm_resources/urls.yaml` and downloads them into the `.llm_resources/` directory, recreating the URL's path structure.

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

   Check the `.llm_resources/` directory to confirm files have been updated. For example, you should see a `developers.cloudflare.com` subdirectory with the downloaded files.

### Configuration

To modify resource URLs, edit `.llm_resources/urls.yaml`. The following resources are currently configured:

```yaml
# List of LLM resource files to download.
# Add or remove URLs here to update the list of files to be downloaded.
resources:
  # Cloudflare
  - https://developers.cloudflare.com/llms.txt
  # Cloudflare Workers
  - https://developers.cloudflare.com/workers/llms-full.txt
  # Cloudflare AI Gateway
  - https://developers.cloudflare.com/ai-gateway/llms-full.txt
```
