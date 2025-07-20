import { filterActivate } from "./filters/filterActivate.ts";
import { getReposForOrg } from "./get-repos-in-org.ts";
import { Octokit } from "npm:@octokit/rest@19.0.4";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";

interface Repository {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  created_at: string;
  updated_at: string;
  language: string | null;
  archived?: boolean;
}

interface FilteredRepository {
  name: string;
  fullName: string;
  url: string;
  description: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  language: string;
}

interface ListReposInOrgOptions {
  org: string;
  output?: string;
}

interface ListReposInOrgResult {
  success: boolean;
  summary?: {
    organization: string;
    timestamp: string;
    totalRepositories: number;
    filteredRepositories: number;
  };
  outputPath?: string;
  repositories?: FilteredRepository[];
  error?: string;
}

// Octokitの初期化
function createOctokit(token?: string): Octokit {
  return new Octokit({
    auth: token,
  });
}

// メインのリポジトリ一覧取得ロジック
async function listReposInOrg(
  options: ListReposInOrgOptions
): Promise<ListReposInOrgResult> {
  try {
    const { org, output = ".output" } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
    }

    // .envファイルの読み込み
    const env = await load();
    const token = env.GH_TOKEN;

    const octokit = createOctokit(token);

    if (!token) {
      console.warn(
        "GH_TOKEN environment variable is not set. Private repositories may not be accessible.",
        "To access private repositories, please set GH_TOKEN in your .env file."
      );
    }

    // リポジトリの取得
    console.log("📚 Fetching repositories...");
    const repos = await getReposForOrg(octokit, org);

    // フィルタリング
    const filteredRepos = filterActivate(repos);

    console.log(
      `\n🔍 Found ${repos.length} repositories (${filteredRepos.length} active)`
    );

    // ファイル出力
    await ensureDir(output);
    const outputPath = join(output, `${org}-repos.json`);

    const repositories = filteredRepos.map((repo: Repository) => ({
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      description: repo.description || "",
      isPrivate: repo.private,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      language: repo.language || "",
    }));

    const jsonContent = JSON.stringify(
      {
        organization: org,
        timestamp: new Date().toISOString(),
        repositories,
      },
      null,
      2
    );

    await Deno.writeTextFile(outputPath, jsonContent);

    const summary = {
      organization: org,
      timestamp: new Date().toISOString(),
      totalRepositories: repos.length,
      filteredRepositories: filteredRepos.length,
    };

    return { success: true, summary, outputPath, repositories };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

// CLI用のメイン処理
async function main() {
  const flags = parseArgs(Deno.args, {
    string: ["org", "output"],
    default: {
      output: ".output",
    },
  });

  if (!flags.org) {
    console.error(
      "Usage: deno task start src/list-repos-in-org/index.ts --org=organization [--output=output-directory]"
    );
    Deno.exit(1);
  }

  const result = await listReposInOrg({
    org: flags.org,
    output: flags.output,
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary && result.outputPath) {
    console.log(`Repository list has been output to ${result.outputPath}`);
    console.log(`\n📊 Summary:`);
    console.log(`- Organization: ${result.summary.organization}`);
    console.log(`- Total repositories: ${result.summary.totalRepositories}`);
    console.log(
      `- Active repositories: ${result.summary.filteredRepositories}`
    );
  }
}

// TUI用の実行関数
export async function executeListReposInOrg(): Promise<void> {
  const { Input } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts"
  );

  try {
    // 組織名の入力
    const org = await Input.prompt({
      message: "Enter organization name:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Organization name is required",
    });

    // 設定内容の確認
    console.log("\n📋 Settings:");
    console.log(`Organization: ${org}`);

    const options: ListReposInOrgOptions = {
      org,
    };

    const result = await listReposInOrg(options);

    if (result.success && result.summary && result.outputPath) {
      console.log(`\nRepository list has been output to ${result.outputPath}`);
      console.log(`\n📊 Summary:`);
      console.log(`- Organization: ${result.summary.organization}`);
      console.log(`- Total repositories: ${result.summary.totalRepositories}`);
      console.log(
        `- Active repositories: ${result.summary.filteredRepositories}`
      );
    } else {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Export functions for TUI
export {
  listReposInOrg,
  type ListReposInOrgOptions,
  type ListReposInOrgResult,
};

if (import.meta.main) {
  main();
}
