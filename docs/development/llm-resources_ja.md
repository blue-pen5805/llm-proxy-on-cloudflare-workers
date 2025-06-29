# LLMリソース

このドキュメントでは、このプロジェクトで使用されるLLM（大規模言語モデル）リソースについて説明します。これらのリソースには、サポートされているLLMモデルのリストが含まれており、自動化されたダウンロードスクリプトによって管理されています。

## 概要

このプロジェクトは、外部ソースからリソースファイルをダウンロードすることで、最新のLLMモデル情報を維持しています。これらのファイルは`.llm_resources/`ディレクトリに保存され、さまざまなプロバイダーから利用可能なモデルの包括的なリストが含まれています。

ダウンロードスクリプト（`./.llm_resources/download.sh`）は、`.llm_resources/urls.yaml`からURLのリストを読み込み、URLのパス構造を再現して`.llm_resources/`ディレクトリにダウンロードします。

## リソースの更新

### 前提条件

プロジェクトの依存関係がインストールされていることを確認してください：

```bash
npm install
```

### ダウンロードプロセス

1. **最新のLLMリソースのダウンロード**：

   ```bash
   npm run download-llm-resources
   ```

2. **更新の確認**：

   `.llm_resources/`ディレクトリをチェックして、ファイルが更新されていることを確認します。例えば、ダウンロードされたファイルを含む`developers.cloudflare.com`サブディレクトリが表示されるはずです。

### 設定

リソースURLを変更するには、`.llm_resources/urls.yaml`を編集します。現在、以下のリソースが設定されています：

```yaml
# ダウンロードするLLMリソースファイルのリスト。
# ダウンロードするファイルのリストを更新するには、ここにURLを追加または削除してください。
resources:
  # Cloudflare
  - https://developers.cloudflare.com/llms.txt
  # Cloudflare Workers
  - https://developers.cloudflare.com/workers/llms-full.txt
  # Cloudflare AI Gateway
  - https://developers.cloudflare.com/ai-gateway/llms-full.txt
```
