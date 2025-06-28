#!/bin/bash
set -euo pipefail

# Base directory for downloaded files
BASE_DIR=".llm_resources"
URL_FILE="$BASE_DIR/urls.yaml"

# Check if urls.yaml exists
if [ ! -f "$URL_FILE" ]; then
  echo "Error: $URL_FILE not found."
  exit 1
fi

# Read each URL from the yaml file and download it
# Extracts lines starting with "- " and removes the prefix.
grep "^  - " "$URL_FILE" | sed 's/^  - //' | while IFS= read -r url; do
  # Skip empty lines
  if [ -z "$url" ]; then
    continue
  fi

  # Extract the path from the URL
  path=$(echo "$url" | sed -e 's|^https\?://||')
  file_path="$BASE_DIR/$path"
  # Create directory and download file
  mkdir -p "$(dirname "$file_path")"
  if ! curl -fL -o "$file_path" "$url"; then
    echo "Failed to download $url"
    rm -f "$file_path"
  fi
done

echo "Downloads complete."
