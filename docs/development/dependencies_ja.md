# 依存関係

このドキュメントでは、プロジェクトの依存関係とその管理方法について説明します。このプロジェクトでは、TypeScriptのコンパイル、テスト、Cloudflare Workersとの連携など、さまざまな機能を実現するためにnpmパッケージを使用しています。

## 概要

このプロジェクトは、`package.json`を通じて依存関係を管理し、自動化ツールを使用してパッケージを最新の状態に保ちます。依存関係には、開発ツール、ランタイムライブラリ、そしてLLMプロキシ機能を実現するためのCloudflare特有のパッケージが含まれます。

主な依存関係は以下の通りです：

- **Wrangler**: Cloudflare Workersのデプロイと管理のため
- **Vitest**: テスト実行のため
- **TypeScript**: 型チェックとコンパイルのため
- **ESLint and Prettier**: コードのリンティングとフォーマットのため

## 依存関係の更新

### 前提条件

`npm-check-updates`をグローバルにインストールします：

```bash
npm install -g npm-check-updates
```

または、一度だけ使用する場合は`npx`を使用します。

### 更新プロセス

1. **古いパッケージの確認**：

   ```bash
   ncu
   ```

2. **`package.json`の更新**：

   ```bash
   ncu -u
   ```

3. **新しいパッケージのインストール**：

   ```bash
   npm install
   ```

4. **Cloudflare Workerの型定義の更新**：

   ```bash
   npm run cf-typegen
   ```

5. **テストの実行**：
   ```bash
   npm run test
   ```

テストが失敗した場合は、更新されたパッケージによって引き起こされた破壊的変更をデバッグします。
