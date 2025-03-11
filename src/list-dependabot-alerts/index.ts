import { Octokit } from "npm:@octokit/rest@19.0.4";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { getReposForOrg } from "./get-repos-in-org.ts";
import { getDependabotAlerts } from "./get-dependabot-alerts.ts";

// Setup
const flags = parseArgs(Deno.args, {
  string: ["org", "output", "state"],
  default: {
    output: ".output",
    state: "open", // open, closed, dismissed, fixed
  },
});

const org = flags.org;

if (org === undefined) {
  console.error(
    "使用方法: deno task start src/list-dependabot-alerts/index.ts --org=組織名 [--output=出力ディレクトリ] [--state=アラートの状態]"
  );
  Deno.exit(1);
}

const auth = Deno.env.get("GH_TOKEN");

if (!auth) {
  console.error(
    "環境変数 GH_TOKEN が設定されていません。",
    "Dependabotアラートを取得するには、write権限を持つトークンが必要です。"
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
  `\n🔍 ${repos.length}個のリポジトリが見つかりました。Dependabotアラートを取得中...\n`
);

const results = await Promise.all(
  repos.map(async (repo) => {
    const result = await getDependabotAlerts(
      octokit,
      org,
      repo.name,
      flags.state
    );
    return {
      repository: repo.name,
      ...result,
    };
  })
);

// Generate file
const outputDir = flags.output;
await ensureDir(outputDir);

const outputPath = join(outputDir, `${org}-dependabot-alerts.json`);

// 結果を分類
const successResults = results.filter((r) => r.status === "success");
const errorResults = results.filter((r) => r.status === "error");
const disabledRepos = errorResults.filter((r) => r.error?.type === "disabled");
const noAccessRepos = errorResults.filter((r) => r.error?.type === "no_access");
const otherErrorRepos = errorResults.filter((r) => r.error?.type === "other");

const totalAlerts = successResults.reduce(
  (sum, repo) => sum + repo.alerts.length,
  0
);
const reposWithAlerts = successResults.filter((repo) => repo.alerts.length > 0);

const jsonContent = JSON.stringify(
  {
    organization: org,
    timestamp: new Date().toISOString(),
    state: flags.state,
    summary: {
      totalRepositories: repos.length,
      accessibleRepositories: successResults.length,
      repositoriesWithAlerts: reposWithAlerts.length,
      totalAlerts,
      inaccessibleRepositories: {
        total: errorResults.length,
        dependabotDisabled: disabledRepos.length,
        noAccess: noAccessRepos.length,
        otherErrors: otherErrorRepos.length,
      },
    },
    accessibleRepositories: successResults
      .filter((repo) => repo.alerts.length > 0)
      .map((repo) => ({
        name: repo.repository,
        alertCount: repo.alerts.length,
        alerts: repo.alerts.map((alert) => ({
          number: alert.number,
          state: alert.state,
          dependency: alert.dependency,
          severity: alert.security_advisory.severity,
          summary: alert.security_advisory.summary,
          description: alert.security_advisory.description,
          vulnerableVersionRange:
            alert.security_vulnerability.vulnerable_version_range,
          firstPatchedVersion:
            alert.security_vulnerability.first_patched_version,
          createdAt: alert.created_at,
          updatedAt: alert.updated_at,
        })),
      })),
    inaccessibleRepositories: {
      dependabotDisabled: disabledRepos.map((r) => ({
        name: r.repository,
        reason: r.error?.message,
      })),
      noAccess: noAccessRepos.map((r) => ({
        name: r.repository,
        reason: r.error?.message,
      })),
      otherErrors: otherErrorRepos.map((r) => ({
        name: r.repository,
        reason: r.error?.message,
      })),
    },
  },
  null,
  2
);

await Deno.writeTextFile(outputPath, jsonContent);
console.log(`\n📝 Dependabotアラート一覧を ${outputPath} に出力しました`);
console.log(`\n📊 サマリー:
- 検査したリポジトリ数: ${repos.length}
  - アクセス可能: ${successResults.length}
    - アラートあり: ${reposWithAlerts.length}
    - 総アラート数: ${totalAlerts}
  - アクセス不可: ${errorResults.length}
    - Dependabot無効: ${disabledRepos.length}
    - アクセス権限なし: ${noAccessRepos.length}
    - その他のエラー: ${otherErrorRepos.length}
`);
