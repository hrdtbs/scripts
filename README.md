# scripts

## 必要条件

- [Deno](https://deno.land/) がインストールされていること

## GitHub トークンの取得

https://github.com/settings/tokens から Personal Access Token を取得してください。

## 環境変数の設定

```bash
export GH_TOKEN="your-github-token"
```

## スクリプトの実行方法

```bash
# リポジトリ一覧の取得
deno task start src/list-repos.ts

# Issue の作成
deno task start src/create-issue.ts

# または従来の方法でも実行可能
deno run --config deno.json --allow-env --allow-net src/list-repos.ts
deno run --config deno.json --allow-env --allow-net src/create-issue.ts
```
