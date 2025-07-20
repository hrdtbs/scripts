import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { Octokit } from "npm:@octokit/rest@20.0.2";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";

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

interface AddLabelsOptions {
  org: string;
  labels: Label[];
}

interface AddLabelsResult {
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
async function addLabelsBulk(
  options: AddLabelsOptions
): Promise<AddLabelsResult> {
  try {
    const { org, labels } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
    }

    if (!labels || labels.length === 0) {
      return { success: false, error: "Labels are required" };
    }

    // .envファイルの読み込み
    const env = await load();
    const token = env.GH_TOKEN;

    if (!token) {
      return {
        success: false,
        error: "GH_TOKEN environment variable is not set",
      };
    }

    const octokit = createOctokit(token);
    const repositories = await getRepositories(octokit, org);
    const activeRepositories = repositories.filter((repo) => !repo.archived);

    let totalSuccessful = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    // 各リポジトリにラベルを追加
    for (const repo of activeRepositories) {
      const result = await addLabels(octokit, org, repo.name, labels);
      totalSuccessful += result.added;
      totalSkipped += result.skipped;
      totalFailed += result.failed;

      // Rate limit対策で少し待機
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const summary = {
      totalRepositories: activeRepositories.length,
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
    string: ["org", "labels", "colors"],
    default: {
      labels: "",
      colors: "",
    },
  });

  const org: string = flags.org || "";
  const labelNames = flags.labels
    .split(",")
    .map((label: string) => label.trim());
  const labelColors = flags.colors
    .split(",")
    .map((color: string) => color.trim());

  if (!org || labelNames.length === 0) {
    console.error(
      "使用方法: deno task start src/add-labels/index.ts --org=ORGANIZATION --labels=LABEL1,LABEL2,... [--colors=COLOR1,COLOR2,...]"
    );
    console.error("\n注意: .envファイルにGH_TOKENを設定してください");
    Deno.exit(1);
  }

  // ラベルと色のペアを作成
  const labels: Label[] = labelNames.map((name: string, index: number) => ({
    name,
    color: labelColors[index] || "000000", // 色が指定されていない場合はデフォルトの黒色を使用
  }));

  const result = await addLabelsBulk({ org, labels });

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
export async function executeAddLabels(): Promise<void> {
  const { Input, Confirm } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts"
  );

  try {
    // 組織名の入力
    const org = await Input.prompt({
      message: "Enter organization name:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Organization name is required",
    });

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

    const confirm = await Confirm.prompt({
      message: "Add labels with these settings?",
      default: true,
    });

    if (!confirm) {
      return;
    }

    const options: AddLabelsOptions = {
      org,
      labels,
    };

    const result = await addLabelsBulk(options);

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
export { addLabelsBulk, type AddLabelsOptions, type AddLabelsResult };

if (import.meta.main) {
  main();
}
