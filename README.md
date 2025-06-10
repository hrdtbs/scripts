# scripts

GitHub組織の管理や分析を行うDenoスクリプト集です。

## 📚 目次

- [list-repos-in-org](#list-repos-in-org) - 組織のリポジトリ一覧取得
- [list-dependabot-alerts](#list-dependabot-alerts) - Dependabotアラート収集・分析
- [create-issue](#create-issue) - Issue作成
- [list-renovate-status](#list-renovate-status) - Renovate稼働状況確認
- [search-actions-in-org](#search-actions-in-org) - GitHub Actions使用状況分析
- [add-labels](#add-labels) - ラベル一括追加
- [list-open-prs](#list-open-prs) - オープンPR一覧取得
- [search-files-in-org](#search-files-in-org) - 組織内ファイル文字列検索
- [🚀 セットアップ](#-セットアップ) - 環境構築・実行方法
- [📁 プロジェクト構造](#-プロジェクト構造) - ディレクトリ構成

---

## list-repos-in-org

組織のリポジトリ一覧を取得し、JSONファイルとして出力します。

```bash
deno task start src/list-repos-in-org/index.ts --org=org-name [--output=出力ディレクトリ]
```

#### オプション

- `--org`: （必須）GitHubの組織名
- `--output`: （オプション）出力ディレクトリのパス（デフォルト: `.output`）

#### 出力

指定したディレクトリに `{組織名}-repos.json` というファイルが生成されます。
ファイルには以下の情報が含まれます：

```json
{
  "organization": "組織名",
  "timestamp": "生成日時",
  "repositories": [
    {
      "name": "リポジトリ名",
      "fullName": "組織名/リポジトリ名",
      "url": "リポジトリのURL",
      "description": "リポジトリの説明",
      "isPrivate": true/false,
      "createdAt": "作成日時",
      "updatedAt": "更新日時",
      "language": "主要プログラミング言語"
    }
  ]
}
```

## list-dependabot-alerts

組織内の全リポジトリのDependabotアラートを取得し、JSONファイルとして出力します。

```bash
deno task start src/list-dependabot-alerts/index.ts --org=org-name [--output=出力ディレクトリ] [--state=アラートの状態] [--format=出力形式]
```

#### オプション

- `--org`: （必須）GitHubの組織名
- `--output`: （オプション）出力ディレクトリのパス（デフォルト: `.output`）
- `--state`: （オプション）アラートの状態（デフォルト: `open`）
  - `open`: 未解決のアラート
  - `closed`: 解決済みのアラート
  - `dismissed`: 却下されたアラート
  - `fixed`: 修正済みのアラート
- `--format`: （オプション）出力形式（デフォルト: `json`）
  - `json`: JSON形式で出力
  - `csv`: CSV形式で出力

#### 必要な権限

GitHubトークンには以下の権限が必要です：
- `repo`: リポジトリへのフルアクセス
- `security_events`: セキュリティイベントの読み取り

#### 出力

指定したディレクトリに以下の2つのファイルが生成されます：

1. `{組織名}-dependabot-alerts.{json|csv}`: アラート情報
   - `--format=json`の場合（デフォルト）:
   ```json
   [
     {
       "organization": "組織名",
       "timestamp": "生成日時",
       "state": "アラートの状態",
       "repository": "リポジトリ名",
       "number": "アラート番号",
       "alert_id": "アラートID",
       "dependency": {
         "package": {
           "ecosystem": "パッケージエコシステム",
           "name": "パッケージ名"
         },
         "manifest_path": "マニフェストファイルのパス",
         "scope": "依存関係のスコープ",
         "relationship": "依存関係の種類"
       },
       "severity": "深刻度（critical/high/medium/low）",
       "summary": "概要",
       "description": "詳細な説明",
       "vulnerableVersionRange": "脆弱性のあるバージョン範囲",
       "firstPatchedVersion": "最初の修正バージョン",
       "createdAt": "作成日時",
       "updatedAt": "更新日時"
     }
   ]
   ```

   - `--format=csv`の場合:
   ```csv
   organization,timestamp,state,repository,number,alert_id,package_ecosystem,package_name,manifest_path,scope,relationship,severity,summary,vulnerable_version_range,first_patched_version,created_at,updated_at
   組織名,生成日時,アラートの状態,リポジトリ名,アラート番号,アラートID,パッケージエコシステム,パッケージ名,マニフェストファイルのパス,依存関係のスコープ,依存関係の種類,深刻度,概要,脆弱性のあるバージョン範囲,最初の修正バージョン,作成日時,更新日時
   ```

2. `{組織名}-dependabot-errors.json`: エラー情報
```json
{
  "organization": "組織名",
  "timestamp": "生成日時",
  "summary": {
    "totalErrors": "エラーの総数",
    "dependabotDisabled": "Dependabotが無効なリポジトリ数",
    "noAccess": "アクセス権限がないリポジトリ数",
    "otherErrors": "その他のエラー数"
  },
  "errors": {
    "dependabotDisabled": [
      {
        "repository": "リポジトリ名",
        "reason": "エラーの理由",
        "settingsUrl": "設定ページのURL"
      }
    ],
    "noAccess": [
      {
        "repository": "リポジトリ名",
        "reason": "エラーの理由"
      }
    ],
    "otherErrors": [
      {
        "repository": "リポジトリ名",
        "reason": "エラーの理由"
      }
    ]
  }
}
```

また、実行結果のサマリーがコンソールに出力されます：
```
📊 サマリー:
- 検査したリポジトリ数: 総数
  - アクセス可能: 成功数
    - アラートあり: アラートがあるリポジトリ数
    - 総アラート数: アラートの総数
      - Critical: 重大度のアラート数
      - High: 高重要度のアラート数
      - Medium: 中重要度のアラート数
      - Low: 低重要度のアラート数
  - アクセス不可: エラー数
    - Dependabot無効: Dependabotが無効なリポジトリ数
    - アクセス権限なし: アクセス権限がないリポジトリ数
    - その他のエラー: その他のエラー数
```

## create-issue

```bash
deno run --allow-env --allow-net src/create-issue/index.ts --repo=repo-name
```

## list-renovate-status

組織内のリポジトリのRenovateの有効化状況を確認するスクリプトです。各リポジトリのDependency Dashboardを解析し、依存関係の更新状況をグループごとに集計します。

```bash
deno task start src/list-renovate-status/index.ts --org=組織名 [--output=出力ディレクトリ]
```

#### オプション

- `--org`: 必須。対象の組織名
- `--output`: 任意。出力ディレクトリ（デフォルト: `.output`）

#### 出力形式

`${org}-renovate-status.json`ファイルに以下の形式で出力されます：

```json
{
  "organization": "組織名",
  "timestamp": "2024-03-11T12:34:56.789Z",
  "summary": {
    "totalRepositories": 10,
    "enabledRepositories": 5,
    "disabledRepositories": 5,
    "totalManagedDependencies": 100
  },
  "repositories": {
    "enabled": [
      {
        "name": "repo-name",
        "dependencyCount": 20,
        "dashboardUrl": "https://github.com/org/repo/issues/1",
        "dependencyGroups": [
          {
            "title": "Rate-Limited",
            "count": 10,
            "dependencies": [
              "@types/node",
              "cloud.google.com/go/videointelligence",
              // ...
            ]
          },
          {
            "title": "Open",
            "count": 5,
            "dependencies": [
              "github.com/arran4/golang-ical",
              // ...
            ]
          },
          {
            "title": "Ignored or Blocked",
            "count": 5,
            "dependencies": [
              "github.com/matsuri-tech/date-go/v2",
              // ...
            ]
          }
        ]
      }
    ],
    "disabled": [
      {
        "name": "repo-name"
      }
    ]
  }
}
```

コンソール出力では、以下のような形式でサマリーが表示されます：

```
📊 サマリー:
- 検査したリポジトリ数: 10
  - Renovate有効: 5
    - 管理対象の依存関係数: 100
    - Rate-Limited: 50
    - Open: 30
    - Ignored or Blocked: 20
  - Renovate無効: 5
```

## search-actions-in-org

組織内の全リポジトリのGitHub Actions使用状況を分析し、特定のアクションの直接的・間接的な使用状況をJSONファイルとして出力します。

```bash
deno task start src/search-actions-in-org/index.ts --org=org-name --action=action-name [--output=出力ディレクトリ]
```

#### オプション

- `--org`: （必須）GitHubの組織名
- `--action`: （必須）検索対象のGitHub Action（例: `actions/checkout`）
- `--output`: （オプション）出力ディレクトリのパス（デフォルト: `.output`）

#### 必要な権限

GitHubトークンには以下の権限が必要です：
- `repo`: リポジトリへのアクセス権限

#### 出力

指定したディレクトリに `{組織名}-action-usage.json` というファイルが生成されます。
ファイルには以下の情報が含まれます：

```json
{
  "organization": "組織名",
  "timestamp": "生成日時",
  "targetAction": "検索対象のアクション",
  "summary": {
    "totalRepositories": "スキャンしたリポジトリの総数",
    "repositoriesScanned": "スキャンに成功したリポジトリ数",
    "repositoriesWithDirectUsage": "直接使用しているリポジトリ数",
    "repositoriesWithIndirectUsage": "間接的に使用しているリポジトリ数",
    "totalDirectUsages": "直接使用の総数",
    "totalIndirectUsages": "間接的な使用の総数"
  },
  "directUsages": [
    {
      "repo": "リポジトリ名",
      "workflow": "ワークフローファイルのパス"
    }
  ],
  "indirectUsages": {
    "アクション名": [
      {
        "repo": "リポジトリ名",
        "workflow": "ワークフローファイルのパス"
      }
    ]
  },
  "errors": {
    "accessErrors": ["アクセスエラーが発生したリポジトリ"],
    "scanErrors": ["スキャンエラーが発生したリポジトリ"]
  }
}
```

コンソール出力では、以下のような形式でサマリーが表示されます：

```
📊 サマリー:
- 直接使用:
  - リポジトリ数: 10
  - 使用回数: 15
- 間接的な使用:
  - リポジトリ数: 5
  - 使用回数: 8
  - 使用アクション数: 3
```

## add-labels

組織内の全リポジトリに指定されたラベルを追加します。アーカイブされたリポジトリはスキップされます。

```bash
deno task start src/add-labels/index.ts --org=ORGANIZATION --labels=LABEL1,LABEL2,... [--colors=COLOR1,COLOR2,...]
```

#### オプション

- `--org`: （必須）GitHubの組織名
- `--labels`: （必須）追加するラベルの名前（カンマ区切り）
- `--colors`: （オプション）ラベルの色（カンマ区切り、6桁の16進数）

#### 必要な権限

GitHubトークンには以下の権限が必要です：
- `repo`: リポジトリへのフルアクセス

#### 環境変数

`.env`ファイルに以下の環境変数を設定してください：

```bash
GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### 例

```bash
# ラベルを追加（デフォルトの黒色を使用）
deno task start src/add-labels/index.ts --org=matsuri-tech --labels=bug,enhancement

# ラベルと色を指定して追加
deno task start src/add-labels/index.ts --org=matsuri-tech --labels=bug,enhancement --colors=FF0000,00FF00
```

#### 注意事項

- 既に存在するラベルはスキップされます
- 色が指定されていないラベルにはデフォルトの黒色（`000000`）が使用されます
- 色の数がラベルの数より少ない場合は、残りのラベルにはデフォルトの黒色が使用されます

## list-open-prs

組織内のオープンなプルリクエスト一覧を取得し、JSONまたはCSVファイルとして出力します。
アーカイブされたリポジトリ、ドラフトPRは除外され、作成日時の古い順にソートされます。

```bash
deno task start src/list-open-prs/index.ts --org=org-name [--output=出力ディレクトリ] [--format=出力形式]
```

#### オプション

- `--org`: （必須）GitHubの組織名
- `--output`: （オプション）出力ディレクトリのパス（デフォルト: `.output`）
- `--format`: （オプション）出力形式（デフォルト: `json`）
  - `json`: JSON形式で出力
  - `csv`: CSV形式で出力

#### 必要な権限

GitHubトークンには以下の権限が必要です：
- `repo`: リポジトリへのアクセス権限

#### 出力

指定したディレクトリに `{組織名}-open-prs.{json|csv}` というファイルが生成されます。

- JSON形式の場合:
```json
{
  "organization": "組織名",
  "timestamp": "生成日時",
  "pullRequests": [
    {
      "repository": "リポジトリ名",
      "number": "PR番号",
      "title": "PRのタイトル",
      "url": "PRのURL",
      "createdAt": "作成日時",
      "updatedAt": "更新日時",
      "author": "作成者のユーザー名"
    }
  ]
}
```

- CSV形式の場合:
```csv
repository,number,title,url,createdAt,updatedAt,author
リポジトリ名,PR番号,"PRのタイトル",PRのURL,作成日時,更新日時,作成者のユーザー名
```

また、実行結果のサマリーがコンソールに出力されます：
```
📊 サマリー:
- 組織: 組織名
- オープンPR数: PR数
- 出力形式: json/csv
- 出力ファイル: ファイルパス
```

## search-files-in-org

組織内の全リポジトリで特定の拡張子のファイルから指定された文字列を検索し、JSONまたはCSVファイルとして出力します。
アーカイブされたリポジトリは除外されます。GitHub Search APIを使用した一括検索により、rate limitを効率的に回避します。

```bash
deno task start src/search-files-in-org/index.ts --org=org-name --query=検索文字列 [--extensions=拡張子] [--output=出力ディレクトリ] [--format=出力形式]
```

#### オプション

- `--org`: （必須）GitHubの組織名
- `--query`: （必須）検索する文字列
- `--extensions`: （オプション）検索対象の拡張子（カンマ区切り、デフォルト: `ts,js,tsx,jsx`）
- `--output`: （オプション）出力ディレクトリのパス（デフォルト: `.output`）
- `--format`: （オプション）出力形式（デフォルト: `json`）
  - `json`: JSON形式で出力
  - `csv`: CSV形式で出力

#### 必要な権限

GitHubトークンには以下の権限が必要です：
- `repo`: リポジトリへのアクセス権限

#### 使用例

```bash
# TypeScriptファイルで特定の関数を検索
deno task start src/search-files-in-org/index.ts --org=matsuri-tech --query="useEffect" --extensions="ts,tsx"

# 複数の拡張子でエラーハンドリングパターンを検索
deno task start src/search-files-in-org/index.ts --org=matsuri-tech --query="try catch" --extensions="js,ts,jsx,tsx"

# CSV形式で出力
deno task start src/search-files-in-org/index.ts --org=matsuri-tech --query="console.log" --format=csv
```

#### 出力

指定したディレクトリに `{組織名}-search-results.{json|csv}` というファイルが生成されます。

- JSON形式の場合:
```json
{
  "organization": "組織名",
  "query": "検索クエリ",
  "extensions": ["対象拡張子"],
  "timestamp": "生成日時",
  "summary": {
    "totalRepositories": "検索でヒットしたリポジトリ数",
    "repositoriesWithMatches": "マッチしたリポジトリ数",
    "totalMatches": "総マッチ数",
    "totalFiles": "マッチしたファイル数"
  },
  "results": [
    {
      "repository": "リポジトリ名",
      "file": "ファイル名",
      "path": "ファイルパス",
      "url": "ファイルのURL",
      "matches": [
        {
          "lineNumber": "行番号",
          "line": "マッチした行の内容",
          "context": ["前後の文脈を含む行の配列"]
        }
      ]
    }
  ],
  "errors": [
    {
      "repository": "エラーが発生したリポジトリ名",
      "error": "エラーメッセージ"
    }
  ]
}
```

- CSV形式の場合:
```csv
repository,file,path,url,lineNumber,matchedLine,contextBefore,contextAfter
リポジトリ名,ファイル名,ファイルパス,ファイルのURL,行番号,"マッチした行","前の文脈","後の文脈"
```

#### 機能

- **一括検索**: GitHub Search APIを使用した組織全体の効率的な検索
- **文字列検索**: 大文字小文字を区別しない部分一致検索
- **拡張子フィルター**: 指定された拡張子のファイルのみを対象
- **文脈表示**: マッチした行の前後の文脈情報（GitHub APIの制限内で）
- **詳細統計**: リポジトリ毎・ファイル毎のマッチ数を詳細表示
- **スマート表示**: ファイル数が多い場合は上位結果のみ表示
- **エラーハンドリング**: アクセス権限エラー等の適切な処理
- **Rate limit対策**: 効率的なAPI使用でrate limit回避

#### 検索方式の特徴

- 従来の各リポジトリ個別検索ではなく、組織全体での一括検索を採用
- GitHub Search APIのtext-match機能を活用して効率的にマッチ情報を取得
- 拡張子毎に分割検索を行い、APIの検索制限に対応
- 全件取得を目指し、GitHub Search APIの1000件制限まで完全にページネーション処理
- 制限に達した場合は警告表示と詳細統計を提供

また、実行結果のサマリーがコンソールに出力されます：
```
📊 検索結果サマリー:
- 組織: 組織名
- 検索クエリ: "検索文字列"
- 対象拡張子: .ts, .js, .tsx, .jsx
- 検索したリポジトリ数: リポジトリ数
- マッチしたリポジトリ数: マッチしたリポジトリ数
- マッチしたファイル数: ファイル数
- 総マッチ数: マッチ数
- エラー数: エラー数
- 出力形式: json/csv
- 出力ファイル: ファイルパス

📋 リポジトリ毎のマッチ詳細:
  📁 repo-name-1: 25 マッチ (3 ファイル)
    📄 src/components/Button.tsx: 15 マッチ
    📄 src/utils/helpers.ts: 8 マッチ
    📄 src/pages/index.tsx: 2 マッチ
  📁 repo-name-2: 12 マッチ (2 ファイル)
    📄 lib/api.js: 10 マッチ
    📄 config/settings.js: 2 マッチ

📈 検索統計:
  .ts: 150/200 件 ✅ 完全
  .js: 1000/1500 件 ⚠️ 制限あり
  .tsx: 50/50 件 ✅ 完全
  .jsx: 25/25 件 ✅ 完全

⚠️  注意: 一部の拡張子でGitHub Search APIの1000件制限に達しました
   より多くの結果を取得するには、検索クエリをより具体的にしてください
```

---

## 🚀 セットアップ

### 前提条件

- [Deno](https://deno.land/) v1.40.0 以上
- GitHub Personal Access Token

### 環境変数の設定

プロジェクトルートに `.env` ファイルを作成し、GitHub Personal Access Tokenを設定してください：

```bash
GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### GitHub Personal Access Tokenの作成

1. GitHub の [Personal Access Tokens](https://github.com/settings/tokens) ページにアクセス
2. "Generate new token" → "Generate new token (classic)" をクリック
3. 必要な権限を選択：
   - `repo`: リポジトリへのフルアクセス（全スクリプト共通）
   - `security_events`: セキュリティイベントの読み取り（Dependabotアラート用）
4. トークンを生成し、`.env` ファイルに設定

### 実行方法

各スクリプトは以下の形式で実行できます：

```bash
deno task start src/{スクリプト名}/index.ts [オプション...]
```

例：
```bash
# リポジトリ一覧を取得
deno task start src/list-repos-in-org/index.ts --org=your-org

# オープンPRを検索
deno task start src/list-open-prs/index.ts --org=your-org --format=csv

# ファイル内文字列を検索
deno task start src/search-files-in-org/index.ts --org=your-org --query="useEffect"
```

## 📁 プロジェクト構造

```
scripts/
├── src/                           # メインのソースコード
│   ├── list-repos-in-org/         # リポジトリ一覧取得
│   ├── list-dependabot-alerts/    # Dependabotアラート分析
│   ├── create-issue.ts            # Issue作成
│   ├── list-renovate-status/      # Renovate状況確認
│   ├── search-actions-in-org/     # GitHub Actions分析
│   ├── add-labels/                # ラベル管理
│   ├── list-open-prs/             # PR管理
│   └── search-files-in-org/       # ファイル検索
├── .output/                       # 出力ファイル格納ディレクトリ
├── deno.json                      # Deno設定ファイル
├── deno.lock                      # 依存関係のロックファイル
└── README.md                      # プロジェクトドキュメント
```

