import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { Octokit } from "npm:@octokit/rest@20.0.2";
import { getGitHubToken } from "../../utils/github-token.ts";

// 型定義
interface Repository {
  name: string;
  archived: boolean;
}

interface GitHubError {
  status: number;
  message: string;
}

interface GitHubRepoResponse {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  archived?: boolean;
  [key: string]: unknown;
}

interface Label {
  name: string;
  color: string;
}

interface BulkAddLabelsOptions {
  org: string;
  labels: Label[];
  repositories?: string[]; // 指定されたリポジトリ名の配列（未指定の場合は全リポジトリ）
}

interface BulkAddLabelsResult {
  success: boolean;
  summary?: {
    totalRepositories: number;
    successfulLabels: number;
    failedLabels: number;
    skippedLabels: number;
  };
  error?: string;
}

// Octokitの初期化
function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
  });
}

// リポジトリ一覧の取得
async function getRepositories(
  octokit: Octokit,
  org: string
): Promise<Repository[]> {
  const repos: Repository[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.repos.listForOrg({
      org,
      type: "all",
      per_page: 100,
      page,
    });

    repos.push(
      ...data.map((repo: GitHubRepoResponse) => ({
        name: repo.name,
        archived: repo.archived || false,
      }))
    );

    if (data.length < 100) {
      break;
    }
    page++;
  }

  return repos;
}

// ラベルの追加
async function addLabels(
  octokit: Octokit,
  org: string,
  repoName: string,
  labels: Label[]
): Promise<{
  success: boolean;
  added: number;
  skipped: number;
  failed: number;
}> {
  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const label of labels) {
    try {
      await octokit.issues.createLabel({
        owner: org,
        repo: repoName,
        name: label.name,
        color: label.color,
      });
      added++;
    } catch (error) {
      const githubError = error as GitHubError;
      if (githubError.status === 422) {
        skipped++;
      } else {
        failed++;
      }
    }
  }

  return { success: true, added, skipped, failed };
}

// メインのラベル追加ロジック
async function bulkAddLabels(
  options: BulkAddLabelsOptions
): Promise<BulkAddLabelsResult> {
  try {
    const { org, labels, repositories } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
    }

    if (!labels || labels.length === 0) {
      return { success: false, error: "Labels are required" };
    }

    const token = await getGitHubToken();
    const octokit = createOctokit(token);

    let targetRepositories: Repository[] = [];

    if (repositories && repositories.length > 0) {
      // 指定されたリポジトリのみを対象とする
      const allRepositories = await getRepositories(octokit, org);
      const allReposMap = new Map(
        allRepositories.map((repo) => [repo.name, repo])
      );

      for (const repoName of repositories) {
        const repo = allReposMap.get(repoName);
        if (repo) {
          targetRepositories.push(repo);
        } else {
          console.log(
            `Warning: Repository "${repoName}" not found in organization "${org}"`
          );
        }
      }
    } else {
      // 全リポジトリを対象とする
      const allRepositories = await getRepositories(octokit, org);
      targetRepositories = allRepositories.filter((repo) => !repo.archived);
    }

    let totalSuccessful = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    // 各リポジトリにラベルを追加
    for (const repo of targetRepositories) {
      const result = await addLabels(octokit, org, repo.name, labels);
      totalSuccessful += result.added;
      totalSkipped += result.skipped;
      totalFailed += result.failed;

      // Rate limit対策で少し待機
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const summary = {
      totalRepositories: targetRepositories.length,
      successfulLabels: totalSuccessful,
      failedLabels: totalFailed,
      skippedLabels: totalSkipped,
    };

    return { success: true, summary };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

// CLI用のメイン処理
async function main() {
  const flags = parseArgs(Deno.args, {
    string: ["org", "labels", "colors", "repos"],
    default: {
      labels: "",
      colors: "",
      repos: "",
    },
  });

  const org: string = flags.org || "";
  const labelNames = flags.labels
    .split(",")
    .map((label: string) => label.trim());
  const labelColors = flags.colors
    .split(",")
    .map((color: string) => color.trim());
  const repositories = flags.repos
    .split(",")
    .map((repo: string) => repo.trim())
    .filter((repo: string) => repo.length > 0);

  if (!org || labelNames.length === 0) {
    console.error(
      "使用方法: deno task start src/bulk-add-labels/index.ts --org=ORGANIZATION --labels=LABEL1,LABEL2,... [--colors=COLOR1,COLOR2,...] [--repos=REPO1,REPO2,...]"
    );
    console.error(
      "\n認証: gh auth login で認証してください"
    );
    console.error(
      "\n--reposオプションを指定しない場合は、全リポジトリが対象になります"
    );
    Deno.exit(1);
  }

  // ラベルと色のペアを作成
  const labels: Label[] = labelNames.map((name: string, index: number) => ({
    name,
    color: labelColors[index] || "000000", // 色が指定されていない場合はデフォルトの黒色を使用
  }));

  const result = await bulkAddLabels({
    org,
    labels,
    repositories: repositories.length > 0 ? repositories : undefined,
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary) {
    console.log(
      `Label addition completed: ${result.summary.successfulLabels} added, ${result.summary.skippedLabels} skipped, ${result.summary.failedLabels} failed`
    );
  }
}

// TUI用の実行関数
export async function executeBulkAddLabels(): Promise<void> {
  const { Input, Confirm, Select } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts"
  );

  try {
    // 組織名の入力
    const org = await Input.prompt({
      message: "Enter organization name:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Organization name is required",
    });

    // リポジトリ選択モードの選択
    const mode = await Select.prompt({
      message: "Select repository mode:",
      options: [
        { name: "All repositories (excluding archived)", value: "all" },
        { name: "Specify repositories", value: "specific" },
      ],
      default: "all",
    });

    let repositories: string[] | undefined;
    if (mode === "specific") {
      const reposInput = await Input.prompt({
        message: "Enter repository names (comma-separated):",
        validate: (value: string) =>
          value.trim().length > 0 ? true : "Repository names are required",
      });
      repositories = reposInput
        .split(",")
        .map((repo: string) => repo.trim())
        .filter((repo: string) => repo.length > 0);
    }

    // ラベル名の入力
    const labelsInput = await Input.prompt({
      message: "Enter label names (comma-separated):",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Label names are required",
    });
    const labelNames = labelsInput
      .split(",")
      .map((label: string) => label.trim())
      .filter((label: string) => label.length > 0);

    // 色の入力（オプション）
    const useColors = await Confirm.prompt({
      message: "Specify custom colors?",
      default: false,
    });

    let labelColors: string[] = [];
    if (useColors) {
      const colorsInput = await Input.prompt({
        message: "Enter colors (comma-separated, hex format like 000000):",
      });
      labelColors = colorsInput
        .split(",")
        .map((color: string) => color.trim())
        .filter((color: string) => color.length > 0);
    }

    // ラベルと色のペアを作成
    const labels: Label[] = labelNames.map((name: string, index: number) => ({
      name,
      color: labelColors[index] || "000000",
    }));

    // 設定内容の確認
    console.log("\n📋 Settings:");
    console.log(`Organization: ${org}`);
    console.log(
      `Repositories: ${
        mode === "all"
          ? "All repositories (excluding archived)"
          : repositories?.join(", ")
      }`
    );
    console.log(
      `Labels: ${labels.map((l) => `${l.name} (${l.color})`).join(", ")}`
    );

    const confirm = await Confirm.prompt({
      message: "Add labels with these settings?",
      default: true,
    });

    if (!confirm) {
      return;
    }

    const options: BulkAddLabelsOptions = {
      org,
      labels,
      repositories,
    };

    const result = await bulkAddLabels(options);

    if (result.success && result.summary) {
      console.log(
        `Label addition completed: ${result.summary.successfulLabels} added, ${result.summary.skippedLabels} skipped, ${result.summary.failedLabels} failed`
      );
    } else {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Export functions for TUI
export { bulkAddLabels, type BulkAddLabelsOptions, type BulkAddLabelsResult };

if (import.meta.main) {
  main();
}
