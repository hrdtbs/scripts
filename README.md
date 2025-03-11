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
deno task start src/list-dependabot-alerts/index.ts --org=org-name [--output=出力ディレクトリ] [--state=アラートの状態]
```

#### オプション

- `--org`: （必須）GitHubの組織名
- `--output`: （オプション）出力ディレクトリのパス（デフォルト: `.output`）
- `--state`: （オプション）アラートの状態（デフォルト: `open`）
  - `open`: 未解決のアラート
  - `closed`: 解決済みのアラート
  - `dismissed`: 却下されたアラート
  - `fixed`: 修正済みのアラート

#### 必要な権限

GitHubトークンには以下の権限が必要です：
- `repo`: リポジトリへのフルアクセス
- `security_events`: セキュリティイベントの読み取り

#### 出力

指定したディレクトリに `{組織名}-dependabot-alerts.json` というファイルが生成されます。
ファイルには以下の情報が含まれます：

```json
{
  "organization": "組織名",
  "timestamp": "生成日時",
  "state": "アラートの状態",
  "totalAlerts": "総アラート数",
  "repositories": [
    {
      "name": "リポジトリ名",
      "alertCount": "アラート数",
      "alerts": [
        {
          "number": "アラート番号",
          "state": "アラートの状態",
          "dependency": "依存パッケージ名",
          "severity": "深刻度",
          "summary": "概要",
          "description": "詳細な説明",
          "vulnerableVersionRange": "脆弱性のあるバージョン範囲",
          "firstPatchedVersion": "最初の修正バージョン",
          "createdAt": "作成日時",
          "updatedAt": "更新日時"
        }
      ]
    }
  ]
}
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
