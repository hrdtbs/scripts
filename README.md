# scripts

### list-repos-in-org

組織のリポジトリ一覧を取得し、JSONファイルとして出力します。

```bash
deno start src/list-repos-in-org/index.ts --org=org-name [--output=出力ディレクトリ]
```

#### オプション

- `--org`: （必須）GitHubの組織名
- `--output`: （オプション）出力ディレクトリのパス（デフォルト: `output`）

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

### create-issue

```bash
deno run --allow-env --allow-net src/create-issue/index.ts --repo=repo-name
```