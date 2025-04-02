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

const alertsOutputPath = join(outputDir, `${org}-dependabot-alerts.json`);
const errorsOutputPath = join(outputDir, `${org}-dependabot-errors.json`);

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

// 重要度ごとの集計
type Severity = "critical" | "high" | "medium" | "low" | "unknown";
const severityCounts: Record<Severity, number> = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
};

successResults.forEach((repo) => {
  repo.alerts.forEach((alert) => {
    const severity = alert.security_advisory.severity.toLowerCase() as Severity;
    severityCounts[severity] = (severityCounts[severity] || 0) + 1;
  });
});

// アラート情報の出力
const alertsContent = JSON.stringify(
  successResults
    .filter((repo) => repo.alerts.length > 0)
    .flatMap((repo) =>
      repo.alerts.map((alert) => ({
        organization: org,
        timestamp: new Date().toISOString(),
        state: alert.state,
        repository: repo.repository,
        number: alert.number,
        alert_id: alert.number,
        dependency: alert.dependency,
        severity: alert.security_advisory.severity.toLowerCase(),
        summary: alert.security_advisory.summary,
        description: alert.security_advisory.description,
        vulnerableVersionRange:
          alert.security_vulnerability.vulnerable_version_range,
        firstPatchedVersion: alert.security_vulnerability.first_patched_version,
        createdAt: alert.created_at,
        updatedAt: alert.updated_at,
      }))
    ),
  null,
  2
);

// エラー情報の出力
const errorsContent = JSON.stringify(
  {
    organization: org,
    timestamp: new Date().toISOString(),
    summary: {
      totalErrors: errorResults.length,
      dependabotDisabled: disabledRepos.length,
      noAccess: noAccessRepos.length,
      otherErrors: otherErrorRepos.length,
    },
    errors: {
      dependabotDisabled: disabledRepos.map((r) => ({
        repository: r.repository,
        reason: r.error?.message,
        settingsUrl: `https://github.com/${org}/${r.repository}/settings/security_analysis`,
      })),
      noAccess: noAccessRepos.map((r) => ({
        repository: r.repository,
        reason: r.error?.message,
      })),
      otherErrors: otherErrorRepos.map((r) => ({
        repository: r.repository,
        reason: r.error?.message,
      })),
    },
  },
  null,
  2
);

await Deno.writeTextFile(alertsOutputPath, alertsContent);
await Deno.writeTextFile(errorsOutputPath, errorsContent);

console.log(`\n📝 Dependabotアラート一覧を ${alertsOutputPath} に出力しました`);
console.log(`📝 エラー情報を ${errorsOutputPath} に出力しました`);
console.log(`\n📊 サマリー:
- 検査したリポジトリ数: ${repos.length}
  - アクセス可能: ${successResults.length}
    - アラートあり: ${reposWithAlerts.length}
    - 総アラート数: ${totalAlerts}
      - Critical: ${severityCounts.critical}
      - High: ${severityCounts.high}
      - Medium: ${severityCounts.medium}
      - Low: ${severityCounts.low}
  - アクセス不可: ${errorResults.length}
    - Dependabot無効: ${disabledRepos.length}
    - アクセス権限なし: ${noAccessRepos.length}
    - その他のエラー: ${otherErrorRepos.length}
`);
