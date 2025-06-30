# 初期セットアップガイド

このガイドでは、`cloudflare-workers-llm-proxy` の初期セットアップ手順について説明します。

## 前提条件

- [Node.js](https://nodejs.org/) (v22.12以降) と npm がインストールされていること。
- [Cloudflare](https://www.cloudflare.com/) アカウントを所有していること。

## 1. プロジェクトのクローンと依存関係のインストール

まず、プロジェクトをローカルにクローンし、必要な依存関係をインストールします。

```bash
# プロジェクトをクローン
git clone https://github.com/your-username/cloudflare-workers-llm-proxy.git

# プロジェクトディレクトリに移動
cd cloudflare-workers-llm-proxy

# 依存関係をインストール
npm install
```

## 2. Cloudflare への認証

Cloudflare Workers にデプロイする前に、`wrangler` を使用して Cloudflare アカウントで認証を行う必要があります。

```bash
# Cloudflare アカウントにログイン
npm run cf:login
```

このコマンドによりブラウザウィンドウが開き、Cloudflare アカウントにログインして `wrangler` が Workers を管理することを承認できます。

## 3. 設定ファイルの作成

提供されたスクリプトを使用して設定ファイルを作成します。

```bash
npm run secrets:create
```

このコマンドにより、テンプレートから `config.jsonc` が作成され、設定プロセスがガイドされます。最低でも1つのプロバイダーを設定する必要があります。

**設定例 (`config.jsonc`):**

```jsonc
{
  "$schema": "../schemas/config-schema.json",
  "PROXY_API_KEY": "your-proxy-api-key",
  "OPENAI_API_KEY": "sk-...",
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "GEMINI_API_KEY": ["YOUR_GEMINI_API_KEY_1", "YOUR_GEMINI_API_KEY_2"],
}
```

`PROXY_API_KEY` はこのプロキシを利用するためのAPIキーです。任意の文字列を設定してください。
その他の `*_API_KEY` には、各プロバイダーから取得した実際のAPIキーを設定してください。`GEMINI_API_KEY` のように、キーを配列で複数指定することも可能です。

## 4. Cloudflare Workers へのデプロイ

設定が完了したら、プロジェクトを Cloudflare Workers にデプロイします。

```bash
npm run deploy
```

初回デプロイ時には、`wrangler.jsonc` に記載された `name` で新しい Worker が作成されます。

## 5. APIキーを Secrets に登録

セキュリティのベストプラクティスとして、APIキーは Cloudflare の Secrets 機能を使用して安全に管理します。

`config.jsonc` に記述した API キーを一括で Secrets に登録するためのスクリプトが用意されています。

```bash
npm run secrets:deploy
```

**重要:**
デプロイ後に `config.jsonc` の `apiKey` を変更した場合は、再度 `npm run secrets:deploy` を実行して Secrets を更新する必要があります。

以上で初期セットアップは完了です。デプロイされた Worker のエンドポイントに対して、OpenAI互換のリクエストを送信できるようになります。
