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
      return { success: false, error: "Organization name is required" };
    }

    if (!repos || repos.length === 0) {
      return { success: false, error: "Repository names are required" };
    }

    if (!title) {
      return { success: false, error: "Title is required" };
    }

    if (!body) {
      return { success: false, error: "Body is required" };
    }

    if (!["json", "csv"].includes(format)) {
      return { success: false, error: "Format must be json or csv" };
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
Bulk Issue Creation Tool for GitHub Organizations

Usage:
  deno run --allow-net --allow-read --allow-write --allow-env \\
    src/create-issues-bulk/index.ts \\
    --org=organization \\
    --repos=repo1,repo2,repo3 \\
    --title="Issue Title" \\
    --body="Issue Body" \\
    [options]

Required Options:
  --org        Target organization name
  --repos      Target repository names (comma-separated)
  --title      Issue title to create
  --body       Issue body content

Options:
  --labels     Labels to add (comma-separated)
  --assignees  Users to assign (comma-separated)
  --output     Output directory (default: .output)
  --format     Output format json|csv (default: json)
  --help       Show this help

Examples:
  deno run --allow-net --allow-read --allow-write --allow-env \\
    src/create-issues-bulk/index.ts \\
    --org=myorg \\
    --repos=frontend,backend,docs \\
    --title="Security Update" \\
    --body="Please update dependencies for security." \\
    --labels=security,maintenance \\
    --assignees=user1,user2

Environment Variables:
  GH_TOKEN     GitHub Personal Access Token (required)
`);
    Deno.exit(0);
  }

  if (!args.org) {
    console.error("Error: --org option is required");
    console.error("Use --help option to show help");
    Deno.exit(1);
  }

  if (!args.repos) {
    console.error("Error: --repos option is required");
    console.error("Example: --repos=repo1,repo2,repo3");
    console.error("Use --help option to show help");
    Deno.exit(1);
  }

  if (!args.title) {
    console.error("Error: --title option is required");
    console.error("Use --help option to show help");
    Deno.exit(1);
  }

  if (!args.body) {
    console.error("Error: --body option is required");
    console.error("Use --help option to show help");
    Deno.exit(1);
  }

  if (!["json", "csv"].includes(args.format)) {
    console.error("Error: --format option must be json or csv");
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
      `Issue creation completed: ${result.summary.summary.successfulCreations} successful, ${result.summary.summary.failedCreations} failed`
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
      message: "Enter organization name:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Organization name is required",
    });

    // リポジトリ名の入力
    const reposInput = await Input.prompt({
      message: "Enter repository names (comma-separated):",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Repository names are required",
    });
    const repos = reposInput
      .split(",")
      .map((repo: string) => repo.trim())
      .filter((repo: string) => repo.length > 0);

    // タイトルの入力
    const title = await Input.prompt({
      message: "Enter issue title:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Title is required",
    });

    // 本文の入力
    const body = await Input.prompt({
      message: "Enter issue body:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Body is required",
    });

    // ラベルの入力（オプション）
    const useLabels = await Confirm.prompt({
      message: "Add labels?",
      default: false,
    });

    let labels: string[] = [];
    if (useLabels) {
      const labelsInput = await Input.prompt({
        message: "Enter label names (comma-separated):",
      });
      labels = labelsInput
        .split(",")
        .map((label: string) => label.trim())
        .filter((label: string) => label.length > 0);
    }

    // アサイニーの入力（オプション）
    const useAssignees = await Confirm.prompt({
      message: "Add assignees?",
      default: false,
    });

    let assignees: string[] = [];
    if (useAssignees) {
      const assigneesInput = await Input.prompt({
        message: "Enter assignee usernames (comma-separated):",
      });
      assignees = assigneesInput
        .split(",")
        .map((assignee: string) => assignee.trim())
        .filter((assignee: string) => assignee.length > 0);
    }

    // 出力形式の選択
    const format = await Select.prompt({
      message: "Select output format:",
      options: [
        { name: "JSON", value: "json" },
        { name: "CSV", value: "csv" },
      ],
      default: "json",
    });

    const confirm = await Confirm.prompt({
      message: "Create issues with these settings?",
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
        `Issue creation completed: ${result.summary.summary.successfulCreations} successful, ${result.summary.summary.failedCreations} failed`
      );
    } else {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

if (import.meta.main) {
  main();
}
