import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { Octokit } from "npm:@octokit/rest@20.0.2";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";

interface PullRequest {
  repository: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: string;
}

interface ListOpenPRsOptions {
  org: string;
  output?: string;
  format?: "json" | "csv";
}

interface ListOpenPRsResult {
  success: boolean;
  summary?: {
    organization: string;
    timestamp: string;
    totalPRs: number;
    outputPath: string;
  };
  pullRequests?: PullRequest[];
  error?: string;
}

// Octokitの初期化
function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
  });
}

// メインのオープンPR取得ロジック
async function listOpenPRs(
  options: ListOpenPRsOptions
): Promise<ListOpenPRsResult> {
  try {
    const { org, output = ".output", format = "json" } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
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

    const octokit = createOctokit(token);

    // オープンPRの取得
    const query = `archived:false user:${org} is:pr is:open draft:false sort:created-asc`;
    const prs: PullRequest[] = [];

    try {
      const { data } = await octokit.rest.search.issuesAndPullRequests({
        q: query,
        per_page: 100,
      });

      for (const item of data.items) {
        prs.push({
          repository: item.repository_url.split("/").slice(-1)[0],
          number: item.number,
          title: item.title,
          url: item.html_url,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          author: item.user?.login || "unknown",
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to fetch pull requests: ${errorMessage}`,
      };
    }

    // ファイル出力
    await ensureDir(output);
    const extension = format;
    const outputPath = join(output, `${org}-open-prs.${extension}`);

    if (format === "csv") {
      const csvContent = convertToCSV(prs);
      await Deno.writeTextFile(outputPath, csvContent);
    } else {
      const output = {
        organization: org,
        timestamp: new Date().toISOString(),
        pullRequests: prs,
      };
      await Deno.writeTextFile(outputPath, JSON.stringify(output, null, 2));
    }

    const summary = {
      organization: org,
      timestamp: new Date().toISOString(),
      totalPRs: prs.length,
      outputPath,
    };

    return { success: true, summary, pullRequests: prs };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

function convertToCSV(prs: PullRequest[]): string {
  const headers = [
    "repository",
    "number",
    "title",
    "url",
    "createdAt",
    "updatedAt",
    "author",
  ];
  const rows = prs.map((pr) => {
    return [
      pr.repository,
      pr.number.toString(),
      `"${pr.title.replace(/"/g, '""')}"`,
      pr.url,
      pr.createdAt,
      pr.updatedAt,
      pr.author,
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// CLI用のメイン処理
async function main() {
  const args = parseArgs(Deno.args, {
    string: ["org", "output", "format"],
    default: {
      output: ".output",
      format: "json",
    },
  });

  if (!args.org) {
    console.error("Error: --org option is required");
    Deno.exit(1);
  }

  if (!["json", "csv"].includes(args.format)) {
    console.error("Error: --format option must be json or csv");
    Deno.exit(1);
  }

  const result = await listOpenPRs({
    org: args.org,
    output: args.output,
    format: args.format as "json" | "csv",
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary) {
    console.log(`📊 Summary:`);
    console.log(`- Organization: ${result.summary.organization}`);
    console.log(`- Open PRs: ${result.summary.totalPRs}`);
    console.log(`- Output format: ${args.format}`);
    console.log(`- Output file: ${result.summary.outputPath}`);
  }
}

// TUI用の実行関数
export async function executeListOpenPRs(): Promise<void> {
  const { Input, Select } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts"
  );

  try {
    // 組織名の入力
    const org = await Input.prompt({
      message: "Enter organization name:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Organization name is required",
    });

    // 出力形式の選択
    const format = await Select.prompt({
      message: "Select output format:",
      options: [
        { name: "JSON", value: "json" },
        { name: "CSV", value: "csv" },
      ],
      default: "json",
    });

    // 設定内容の確認
    console.log("\n📋 Settings:");
    console.log(`Organization: ${org}`);
    console.log(`Output Format: ${format}`);

    const options: ListOpenPRsOptions = {
      org,
      format: format as "json" | "csv",
    };

    const result = await listOpenPRs(options);

    if (result.success && result.summary) {
      console.log(`\n📊 Summary:`);
      console.log(`- Organization: ${result.summary.organization}`);
      console.log(`- Open PRs: ${result.summary.totalPRs}`);
      console.log(`- Output format: ${format}`);
      console.log(`- Output file: ${result.summary.outputPath}`);
    } else {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Export functions for TUI
export { listOpenPRs, type ListOpenPRsOptions, type ListOpenPRsResult };

if (import.meta.main) {
  main();
}
