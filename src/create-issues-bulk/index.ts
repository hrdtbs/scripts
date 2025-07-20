import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { Octokit } from "npm:@octokit/rest@20.0.2";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";

interface IssueCreationResult {
  repository: string;
  success: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

interface IssueCreationSummary {
  organization: string;
  repositories: string[];
  title: string;
  timestamp: string;
  summary: {
    totalRepositories: number;
    successfulCreations: number;
    failedCreations: number;
  };
  results: IssueCreationResult[];
  errors: Array<{
    repository: string;
    error: string;
  }>;
}

async function createIssueInRepository(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[],
  assignees?: string[]
): Promise<IssueCreationResult> {
  try {
    const { data } = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
      assignees,
    });

    return {
      repository: repo,
      success: true,
      issueNumber: data.number,
      issueUrl: data.html_url,
    };
  } catch (error) {
    return {
      repository: repo,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface CreateIssuesBulkOptions {
  org: string;
  repos: string[];
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
  output?: string;
  format?: "json" | "csv";
}

interface CreateIssuesBulkResult {
  success: boolean;
  summary?: IssueCreationSummary;
  error?: string;
}

async function createIssuesBulk(
  options: CreateIssuesBulkOptions
): Promise<CreateIssuesBulkResult> {
  try {
    const {
      org,
      repos,
      title,
      body,
      labels = [],
      assignees = [],
      output = ".output",
      format = "json",
    } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "組織名は必須です" };
    }

    if (!repos || repos.length === 0) {
      return { success: false, error: "リポジトリ名は必須です" };
    }

    if (!title) {
      return { success: false, error: "タイトルは必須です" };
    }

    if (!body) {
      return { success: false, error: "本文は必須です" };
    }

    if (!["json", "csv"].includes(format)) {
      return {
        success: false,
        error: "出力形式はjsonまたはcsvを指定してください",
      };
    }

    // .envファイルの読み込み
    const env = await load();
    const token = env.GH_TOKEN;

    if (!token) {
      return { success: false, error: "GH_TOKEN環境変数が設定されていません" };
    }

    const octokit = new Octokit({
      auth: token,
    });

    const results: IssueCreationResult[] = [];
    const errors: Array<{ repository: string; error: string }> = [];
    let successCount = 0;

    // 各リポジトリにIssueを作成
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];

      try {
        const result = await createIssueInRepository(
          octokit,
          org,
          repo,
          title,
          body,
          labels.length > 0 ? labels : undefined,
          assignees.length > 0 ? assignees : undefined
        );

        results.push(result);

        if (result.success) {
          successCount++;
        } else {
          errors.push({
            repository: repo,
            error: result.error || "Unknown error",
          });
        }

        // Rate limit対策で少し待機
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        results.push({
          repository: repo,
          success: false,
          error: errorMessage,
        });

        errors.push({
          repository: repo,
          error: errorMessage,
        });
      }
    }

    // 結果をまとめる
    const summary: IssueCreationSummary = {
      organization: org,
      repositories: repos,
      title: title,
      timestamp: new Date().toISOString(),
      summary: {
        totalRepositories: repos.length,
        successfulCreations: successCount,
        failedCreations: repos.length - successCount,
      },
      results,
      errors,
    };

    // 出力
    await ensureDir(output);
    const outputPath = join(output, `${org}-issue-creation-results.${format}`);

    if (format === "csv") {
      const csvContent = convertToCSV(summary);
      await Deno.writeTextFile(outputPath, csvContent);
    } else {
      await Deno.writeTextFile(outputPath, JSON.stringify(summary, null, 2));
    }

    return { success: true, summary };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: [
      "org",
      "repos",
      "title",
      "body",
      "labels",
      "assignees",
      "output",
      "format",
    ],
    boolean: ["help"],
    default: {
      output: ".output",
      format: "json",
    },
  });

  if (args.help) {
    console.log(`
GitHub組織の複数リポジトリにIssueを一括作成するツール

使用方法:
  deno run --allow-net --allow-read --allow-write --allow-env \\
    src/create-issues-bulk/index.ts \\
    --org=organization \\
    --repos=repo1,repo2,repo3 \\
    --title="Issue タイトル" \\
    --body="Issue 本文" \\
    [オプション]

必須オプション:
  --org        対象の組織名
  --repos      対象リポジトリ名（カンマ区切り）
  --title      作成するIssueのタイトル
  --body       作成するIssueの本文

オプション:
  --labels     追加するラベル（カンマ区切り）
  --assignees  アサインするユーザー（カンマ区切り）
  --output     出力ディレクトリ（デフォルト: .output）
  --format     出力形式 json|csv（デフォルト: json）
  --help       このヘルプを表示

例:
  deno run --allow-net --allow-read --allow-write --allow-env \\
    src/create-issues-bulk/index.ts \\
    --org=myorg \\
    --repos=frontend,backend,docs \\
    --title="セキュリティアップデート" \\
    --body="依存関係のセキュリティアップデートを実施してください。" \\
    --labels=security,maintenance \\
    --assignees=user1,user2

環境変数:
  GH_TOKEN     GitHub Personal Access Token (必須)
`);
    Deno.exit(0);
  }

  if (!args.org) {
    console.error("エラー: --org オプションは必須です");
    console.error("ヘルプを表示するには --help オプションを使用してください");
    Deno.exit(1);
  }

  if (!args.repos) {
    console.error("エラー: --repos オプションは必須です");
    console.error("例: --repos=repo1,repo2,repo3");
    console.error("ヘルプを表示するには --help オプションを使用してください");
    Deno.exit(1);
  }

  if (!args.title) {
    console.error("エラー: --title オプションは必須です");
    console.error("ヘルプを表示するには --help オプションを使用してください");
    Deno.exit(1);
  }

  if (!args.body) {
    console.error("エラー: --body オプションは必須です");
    console.error("ヘルプを表示するには --help オプションを使用してください");
    Deno.exit(1);
  }

  if (!["json", "csv"].includes(args.format)) {
    console.error(
      "エラー: --format オプションはjsonまたはcsvを指定してください"
    );
    Deno.exit(1);
  }

  const repositories = args.repos.split(",").map((repo) => repo.trim());
  const labels = args.labels
    ? args.labels.split(",").map((label) => label.trim())
    : undefined;
  const assignees = args.assignees
    ? args.assignees.split(",").map((assignee) => assignee.trim())
    : undefined;

  const result = await createIssuesBulk({
    org: args.org,
    repos: repositories,
    title: args.title,
    body: args.body,
    labels: labels || [],
    assignees: assignees || [],
    output: args.output,
    format: args.format as "json" | "csv",
  });

  if (!result.success) {
    console.error(`エラー: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary) {
    console.log(
      `Issue作成完了: 成功${result.summary.summary.successfulCreations}件, 失敗${result.summary.summary.failedCreations}件`
    );
  }
}

function convertToCSV(summary: IssueCreationSummary): string {
  const headers = ["repository", "success", "issueNumber", "issueUrl", "error"];

  const rows = summary.results.map((result) => {
    return [
      result.repository,
      result.success.toString(),
      result.issueNumber?.toString() || "",
      result.issueUrl || "",
      result.error || "",
    ]
      .map((field) => `"${field.replace(/"/g, '""')}"`)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// Export functions for TUI
export {
  createIssuesBulk,
  type CreateIssuesBulkOptions,
  type CreateIssuesBulkResult,
};

// TUI用の実行関数
export async function executeCreateIssuesBulk(): Promise<void> {
  const { Input, Confirm, Select } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts"
  );

  try {
    // 組織名の入力
    const org = await Input.prompt({
      message: "組織名を入力してください:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "組織名は必須です",
    });

    // リポジトリ名の入力
    const reposInput = await Input.prompt({
      message: "リポジトリ名をカンマ区切りで入力してください:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "リポジトリ名は必須です",
    });
    const repos = reposInput
      .split(",")
      .map((repo: string) => repo.trim())
      .filter((repo: string) => repo.length > 0);

    // タイトルの入力
    const title = await Input.prompt({
      message: "Issueのタイトルを入力してください:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "タイトルは必須です",
    });

    // 本文の入力
    const body = await Input.prompt({
      message: "Issueの本文を入力してください:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "本文は必須です",
    });

    // ラベルの入力（オプション）
    const useLabels = await Confirm.prompt({
      message: "ラベルを追加しますか？",
      default: false,
    });

    let labels: string[] = [];
    if (useLabels) {
      const labelsInput = await Input.prompt({
        message: "ラベル名をカンマ区切りで入力してください:",
      });
      labels = labelsInput
        .split(",")
        .map((label: string) => label.trim())
        .filter((label: string) => label.length > 0);
    }

    // アサイニーの入力（オプション）
    const useAssignees = await Confirm.prompt({
      message: "アサイニーを指定しますか？",
      default: false,
    });

    let assignees: string[] = [];
    if (useAssignees) {
      const assigneesInput = await Input.prompt({
        message: "アサイニーのユーザー名をカンマ区切りで入力してください:",
      });
      assignees = assigneesInput
        .split(",")
        .map((assignee: string) => assignee.trim())
        .filter((assignee: string) => assignee.length > 0);
    }

    // 出力形式の選択
    const format = await Select.prompt({
      message: "出力形式を選択してください:",
      options: [
        { name: "JSON", value: "json" },
        { name: "CSV", value: "csv" },
      ],
      default: "json",
    });

    const confirm = await Confirm.prompt({
      message: "この内容でIssueを作成しますか？",
      default: true,
    });

    if (!confirm) {
      return;
    }

    const options: CreateIssuesBulkOptions = {
      org,
      repos,
      title,
      body,
      labels,
      assignees,
      output: ".output",
      format: format as "json" | "csv",
    };

    const result = await createIssuesBulk(options);

    if (result.success && result.summary) {
      console.log(
        `Issue作成完了: 成功${result.summary.summary.successfulCreations}件, 失敗${result.summary.summary.failedCreations}件`
      );
    } else {
      console.log(`エラー: ${result.error}`);
    }
  } catch (error) {
    console.error("エラーが発生しました:", error);
  }
}

if (import.meta.main) {
  main();
}
