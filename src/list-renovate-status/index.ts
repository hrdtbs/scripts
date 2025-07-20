import { Octokit } from "npm:@octokit/rest@19.0.4";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";
import { getReposForOrg } from "./get-repos-in-org.ts";
import {
  getRenovateStatus,
  type RenovateStatus,
} from "./get-renovate-status.ts";

interface Repository {
  name: string;
  archived: boolean;
}

interface RenovateResult {
  repository: string;
  status: "enabled" | "disabled";
  dependencyCount?: number;
  dashboardIssueUrl?: string;
  dependencyGroups?: Array<{
    title: string;
    count: number;
    dependencies: string[];
  }>;
}

interface ListRenovateStatusOptions {
  org: string;
  output?: string;
}

interface ListRenovateStatusResult {
  success: boolean;
  summary?: {
    organization: string;
    timestamp: string;
    totalRepositories: number;
    enabledRepositories: number;
    disabledRepositories: number;
    totalManagedDependencies: number;
    groupTotals: Map<string, number>;
  };
  outputPath?: string;
  error?: string;
}

// Octokitの初期化
function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
  });
}

// メインのRenovateステータス取得ロジック
async function listRenovateStatus(
  options: ListRenovateStatusOptions
): Promise<ListRenovateStatusResult> {
  try {
    const { org, output = ".output" } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
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

    // リポジトリの取得
    console.log("📚 Fetching repositories...");
    const repos = (await getReposForOrg(octokit, org)).filter(
      (repo: Repository) => !repo.archived
    );

    console.log(
      `\n🔍 Found ${repos.length} repositories. Checking Renovate status...\n`
    );

    // Renovateステータスの取得
    const results = await Promise.all(
      repos.map(async (repo: Repository) => {
        const status = await getRenovateStatus(octokit, org, repo.name);
        return {
          repository: repo.name,
          ...status,
        };
      })
    );

    // 結果を分類
    const enabledRepos = results.filter((r) => r.status === "enabled");
    const disabledRepos = results.filter((r) => r.status === "disabled");

    const totalDependencies = enabledRepos.reduce(
      (sum, repo) => sum + (repo.dependencyCount || 0),
      0
    );

    // グループごとの合計を計算
    const groupTotals = new Map<string, number>();
    enabledRepos.forEach((repo) => {
      repo.dependencyGroups?.forEach((group) => {
        const current = groupTotals.get(group.title) || 0;
        groupTotals.set(group.title, current + group.count);
      });
    });

    // ファイル出力
    await ensureDir(output);
    const outputPath = join(output, `${org}-renovate-status.json`);

    const jsonContent = JSON.stringify(
      {
        organization: org,
        timestamp: new Date().toISOString(),
        summary: {
          totalRepositories: repos.length,
          enabledRepositories: enabledRepos.length,
          disabledRepositories: disabledRepos.length,
          totalManagedDependencies: totalDependencies,
        },
        repositories: {
          enabled: enabledRepos.map((repo) => ({
            name: repo.repository,
            dependencyCount: repo.dependencyCount,
            dashboardUrl: repo.dashboardIssueUrl,
            dependencyGroups: repo.dependencyGroups?.map((group) => ({
              title: group.title,
              count: group.count,
              dependencies: group.dependencies,
            })),
          })),
          disabled: disabledRepos.map((repo) => ({
            name: repo.repository,
          })),
        },
      },
      null,
      2
    );

    await Deno.writeTextFile(outputPath, jsonContent);

    const summary = {
      organization: org,
      timestamp: new Date().toISOString(),
      totalRepositories: repos.length,
      enabledRepositories: enabledRepos.length,
      disabledRepositories: disabledRepos.length,
      totalManagedDependencies: totalDependencies,
      groupTotals,
    };

    return { success: true, summary, outputPath };
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

  const org = flags.org;

  if (org === undefined) {
    console.error(
      "Usage: deno task start src/list-renovate-status/index.ts --org=organization [--output=output-directory]"
    );
    Deno.exit(1);
  }

  const result = await listRenovateStatus({
    org,
    output: flags.output,
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary && result.outputPath) {
    console.log(
      `\n📝 Renovate status list has been output to ${result.outputPath}`
    );

    console.log(`\n📊 Summary:
- Repositories checked: ${result.summary.totalRepositories}
  - Renovate enabled: ${result.summary.enabledRepositories}
    - Managed dependencies: ${result.summary.totalManagedDependencies}
${Array.from(result.summary.groupTotals.entries())
  .map(([title, count]) => `      - ${title}: ${count}`)
  .join("\n")}
  - Renovate disabled: ${result.summary.disabledRepositories}
`);
  }
}

// TUI用の実行関数
export async function executeListRenovateStatus(): Promise<void> {
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

    const options: ListRenovateStatusOptions = {
      org,
    };

    const result = await listRenovateStatus(options);

    if (result.success && result.summary && result.outputPath) {
      console.log(
        `\n📝 Renovate status list has been output to ${result.outputPath}`
      );

      console.log(`\n📊 Summary:
- Repositories checked: ${result.summary.totalRepositories}
  - Renovate enabled: ${result.summary.enabledRepositories}
    - Managed dependencies: ${result.summary.totalManagedDependencies}
${Array.from(result.summary.groupTotals.entries())
  .map(([title, count]) => `      - ${title}: ${count}`)
  .join("\n")}
  - Renovate disabled: ${result.summary.disabledRepositories}
`);
    } else {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Export functions for TUI
export {
  listRenovateStatus,
  type ListRenovateStatusOptions,
  type ListRenovateStatusResult,
};

if (import.meta.main) {
  main();
}
