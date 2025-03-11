import { Octokit } from "npm:@octokit/rest@19.0.4";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { getReposForOrg } from "./get-repos-in-org.ts";
import { getRenovateStatus } from "./get-renovate-status.ts";

// Setup
const flags = parseArgs(Deno.args, {
  string: ["org", "output"],
  default: {
    output: ".output",
  },
});

const org = flags.org;

if (org === undefined) {
  console.error(
    "使用方法: deno task start src/list-renovate-status/index.ts --org=組織名 [--output=出力ディレクトリ]"
  );
  Deno.exit(1);
}

const auth = Deno.env.get("GH_TOKEN");

if (!auth) {
  console.error(
    "環境変数 GH_TOKEN が設定されていません。",
    "Renovateのステータスを取得するには、read権限を持つトークンが必要です。"
  );
  Deno.exit(1);
}

const octokit = new Octokit({
  auth,
});

// Run
console.log("📚 リポジトリを取得中...");
const repos = (await getReposForOrg(octokit, org)).filter(
  (repo) => !repo.archived
);

console.log(
  `\n🔍 ${repos.length}個のリポジトリが見つかりました。Renovateのステータスを確認中...\n`
);

const results = await Promise.all(
  repos.map(async (repo) => {
    const status = await getRenovateStatus(octokit, org, repo.name);
    return {
      repository: repo.name,
      ...status,
    };
  })
);

// Generate file
const outputDir = flags.output;
await ensureDir(outputDir);

const outputPath = join(outputDir, `${org}-renovate-status.json`);

// 結果を分類
const enabledRepos = results.filter((r) => r.status === "enabled");
const disabledRepos = results.filter((r) => r.status === "disabled");

const totalDependencies = enabledRepos.reduce(
  (sum, repo) => sum + (repo.dependencyCount || 0),
  0
);

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
console.log(`\n📝 Renovateステータス一覧を ${outputPath} に出力しました`);

// グループごとの合計を計算
const groupTotals = new Map<string, number>();
enabledRepos.forEach((repo) => {
  repo.dependencyGroups?.forEach((group) => {
    const current = groupTotals.get(group.title) || 0;
    groupTotals.set(group.title, current + group.count);
  });
});

console.log(`\n📊 サマリー:
- 検査したリポジトリ数: ${repos.length}
  - Renovate有効: ${enabledRepos.length}
    - 管理対象の依存関係数: ${totalDependencies}
${Array.from(groupTotals.entries())
  .map(([title, count]) => `      - ${title}: ${count}`)
  .join("\n")}
  - Renovate無効: ${disabledRepos.length}
`);
