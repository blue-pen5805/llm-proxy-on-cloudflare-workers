---
description: Steps to add a new environment variable (e.g., API key)
---

Follow these steps in order to add a new environment variable:

1. Add the definition of the new environment variable to the `properties` in `schemas/config-schema.json`.
2. Add the new environment variable to `config.example.jsonc` and include a description in the comments.
   // turbo
3. Run the following command to automatically generate type definitions:
   `npm run cf-typegen`
