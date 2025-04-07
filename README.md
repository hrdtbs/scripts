# scripts

### list-repos-in-org

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

### list-dependabot-alerts

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

### create-issue

```bash
deno run --allow-env --allow-net src/create-issue/index.ts --repo=repo-name
```

### list-renovate-status

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

### search-actions-in-org

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

### add-labels

組織内の全リポジトリに指定されたラベルを追加します。アーカイブされたリポジトリはスキップされます。

```bash
deno task start src/add-labels/index.ts --token=GITHUB_TOKEN --org=ORGANIZATION --labels=LABEL1,LABEL2,... [--colors=COLOR1,COLOR2,...]
```

#### オプション

- `--token`: （必須）GitHubのアクセストークン
- `--org`: （必須）GitHubの組織名
- `--labels`: （必須）追加するラベルの名前（カンマ区切り）
- `--colors`: （オプション）ラベルの色（カンマ区切り、6桁の16進数）

#### 必要な権限

GitHubトークンには以下の権限が必要です：
- `repo`: リポジトリへのフルアクセス

#### 例

```bash
# ラベルを追加（デフォルトの黒色を使用）
deno task start src/add-labels/index.ts --token=ghp_xxx --org=matsuri-tech --labels=bug,enhancement

# ラベルと色を指定して追加
deno task start src/add-labels/index.ts --token=ghp_xxx --org=matsuri-tech --labels=bug,enhancement --colors=FF0000,00FF00
```

#### 注意事項

- 既に存在するラベルはスキップされます
- 色が指定されていないラベルにはデフォルトの黒色（`000000`）が使用されます
- 色の数がラベルの数より少ない場合は、残りのラベルにはデフォルトの黒色が使用されます
