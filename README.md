# scripts

## クイックスタート

### 1. 環境設定

```bash
# リポジトリをクローン
git clone <repository-url>
cd scripts

# 依存関係をインストール
deno task install

# 環境変数を設定
cp .env.example .env
# .envファイルを編集してGitHubトークンを設定
```

### 2. TUIの起動

```bash
deno task start tui/index.ts
```

## 利用可能な機能

### 一括操作
- Bulk Create Issues: 複数リポジトリへのIssue一括作成
- Bulk Add Labels: 複数リポジトリへのラベル一括追加

### 情報収集・分析
- List Dependabot Alerts: Dependabotアラートの収集・分析
- List Open Pull Requests: オープンPR一覧の取得
- List Renovate Status: Renovateの設定状況と依存関係管理状況の確認
- List Repositories: 組織内のリポジトリ一覧取得
- Search Actions: 組織内でのGitHub Actions使用状況の検索・分析
- Search Files: 組織内のファイル内容検索・分析

## 必要な権限

- `--allow-env`: 環境変数の読み取り
- `--allow-net`: ネットワークアクセス（GitHub API）
- `--allow-read`: ファイル読み取り
- `--allow-write`: ファイル書き込み

## 出力ファイル

実行結果は `.output/` ディレクトリに保存されます：
- JSON形式: 詳細なデータ構造
- CSV形式: 表計算ソフトでの分析用

## 開発

### スクリプトの追加

新しいスクリプトを追加する場合：

1. `src/` ディレクトリにスクリプトを作成
2. メイン関数とTUI実行関数を実装
3. `tui/index.ts` にメニュー項目を追加

### 依存関係の更新

```bash
deno task update-deps
```

## ライセンス

MIT License

