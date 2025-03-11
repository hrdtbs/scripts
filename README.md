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