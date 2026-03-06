import { Octokit } from "npm:@octokit/rest@19.0.4";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import { getGitHubToken } from "../../utils/github-token.ts";
import { getReposForOrg } from "./get-repos-in-org.ts";
import { getDependabotAlerts } from "./get-dependabot-alerts.ts";

// 型定義
interface Repository {
  name: string;
  archived: boolean;
}

interface DependabotAlert {
  organization: string;
  timestamp: string;
  state: string;
  repository: string;
  number: number;
  alert_id: number;
  // deno-lint-ignore no-explicit-any
  dependency: Record<string, any>;
  severity: string;
  summary: string;
  description: string;
  vulnerableVersionRange: string;
  firstPatchedVersion: { identifier: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface DependabotError {
  repository: string;
  reason: string;
  settingsUrl?: string;
}

interface DependabotSummary {
  totalRepositories: number;
  successfulRepositories: number;
  errorRepositories: number;
  totalAlerts: number;
  reposWithAlerts: number;
  severityCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  };
  errorSummary: {
    totalErrors: number;
    dependabotDisabled: number;
    noAccess: number;
    otherErrors: number;
  };
}

interface ListDependabotAlertsOptions {
  org: string;
  state?: string;
  output?: string;
  format?: "json" | "csv";
  repositories?: string[];
}

interface ListDependabotAlertsResult {
  success: boolean;
  summary?: DependabotSummary;
  alerts?: DependabotAlert[];
  errors?: {
    dependabotDisabled: DependabotError[];
    noAccess: DependabotError[];
    otherErrors: DependabotError[];
  };
  error?: string;
}

// Octokitの初期化
function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
  });
}

// メインのDependabotアラート取得ロジック
async function listDependabotAlerts(
  options: ListDependabotAlertsOptions
): Promise<ListDependabotAlertsResult> {
  try {
    const {
      org,
      state = "open",
      output = ".output",
      format = "json",
      repositories,
    } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
    }

    if (!["open", "closed", "dismissed", "fixed"].includes(state)) {
      return {
        success: false,
        error: "State must be open, closed, dismissed, or fixed",
      };
    }

    if (!["json", "csv"].includes(format)) {
      return { success: false, error: "Format must be json or csv" };
    }

    const token = await getGitHubToken();
    const octokit = createOctokit(token);

    // リポジトリの取得
    let targetRepositories: Repository[] = [];

    if (repositories && repositories.length > 0) {
      // 指定されたリポジトリのみを対象とする
      const allRepositories = await getReposForOrg(octokit, org);
      const allReposMap = new Map(
        allRepositories.map((repo) => [
          repo.name,
          { name: repo.name, archived: repo.archived || false },
        ])
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
      const allRepositories = await getReposForOrg(octokit, org);
      targetRepositories = allRepositories
        .map((repo) => ({ name: repo.name, archived: repo.archived || false }))
        .filter((repo) => !repo.archived);
    }

    // Dependabotアラートの取得
    const results = await Promise.all(
      targetRepositories.map(async (repo) => {
        const result = await getDependabotAlerts(
          octokit,
          org,
          repo.name,
          state
        );
        return {
          repository: repo.name,
          ...result,
        };
      })
    );

    // 結果を分類
    const successResults = results.filter((r) => r.status === "success");
    const errorResults = results.filter((r) => r.status === "error");
    const disabledRepos = errorResults.filter(
      (r) => r.error?.type === "disabled"
    );
    const noAccessRepos = errorResults.filter(
      (r) => r.error?.type === "no_access"
    );
    const otherErrorRepos = errorResults.filter(
      (r) => r.error?.type === "other"
    );

    const totalAlerts = successResults.reduce(
      (sum, repo) => sum + repo.alerts.length,
      0
    );
    const reposWithAlerts = successResults.filter(
      (repo) => repo.alerts.length > 0
    );

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
        const severity =
          alert.security_advisory.severity.toLowerCase() as Severity;
        severityCounts[severity] = (severityCounts[severity] || 0) + 1;
      });
    });

    // アラート情報の変換
    const alerts: DependabotAlert[] = successResults
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
          firstPatchedVersion:
            alert.security_vulnerability.first_patched_version,
          createdAt: alert.created_at,
          updatedAt: alert.updated_at,
        }))
      );

    // エラー情報の変換
    const errors = {
      dependabotDisabled: disabledRepos.map((r) => ({
        repository: r.repository,
        reason: r.error?.message || "",
        settingsUrl: `https://github.com/${org}/${r.repository}/settings/security_analysis`,
      })),
      noAccess: noAccessRepos.map((r) => ({
        repository: r.repository,
        reason: r.error?.message || "",
      })),
      otherErrors: otherErrorRepos.map((r) => ({
        repository: r.repository,
        reason: r.error?.message || "",
      })),
    };

    // サマリーの作成
    const summary: DependabotSummary = {
      totalRepositories: targetRepositories.length,
      successfulRepositories: successResults.length,
      errorRepositories: errorResults.length,
      totalAlerts,
      reposWithAlerts: reposWithAlerts.length,
      severityCounts,
      errorSummary: {
        totalErrors: errorResults.length,
        dependabotDisabled: disabledRepos.length,
        noAccess: noAccessRepos.length,
        otherErrors: otherErrorRepos.length,
      },
    };

    // ファイル出力
    await ensureDir(output);

    if (format === "csv") {
      const csvHeaders = [
        "organization",
        "timestamp",
        "state",
        "repository",
        "number",
        "alert_id",
        "package_ecosystem",
        "package_name",
        "manifest_path",
        "scope",
        "relationship",
        "severity",
        "summary",
        "vulnerable_version_range",
        "first_patched_version",
        "created_at",
        "updated_at",
      ].join(",");

      const csvRows = alerts.map((alert) =>
        csvHeaders
          .split(",")
          .map((header) => {
            let value: string | number | undefined;
            switch (header) {
              case "package_ecosystem":
                value = alert.dependency.package.ecosystem;
                break;
              case "package_name":
                value = alert.dependency.package.name;
                break;
              case "manifest_path":
                value = alert.dependency.manifest_path;
                break;
              case "scope":
                value = alert.dependency.scope;
                break;
              case "relationship":
                value = alert.dependency.relationship;
                break;
              case "vulnerable_version_range":
                value = alert.vulnerableVersionRange;
                break;
              case "first_patched_version":
                value = alert.firstPatchedVersion?.identifier || "";
                break;
              case "created_at":
                value = alert.createdAt;
                break;
              case "updated_at":
                value = alert.updatedAt;
                break;
              default:
                value = alert[header as keyof DependabotAlert] as string | number | undefined;
            }
            if (
              typeof value === "string" &&
              (value.includes(",") ||
                value.includes('"') ||
                value.includes("\n"))
            ) {
              return `"${value}"`;
            }
            return value;
          })
          .join(",")
      );

      const csvContent = [csvHeaders, ...csvRows].join("\n");
      const alertsOutputPath = join(output, `${org}-dependabot-alerts.csv`);
      await Deno.writeTextFile(alertsOutputPath, csvContent);
    } else {
      const alertsOutputPath = join(output, `${org}-dependabot-alerts.json`);
      await Deno.writeTextFile(
        alertsOutputPath,
        JSON.stringify(alerts, null, 2)
      );
    }

    // エラー情報の出力
    const errorsOutputPath = join(output, `${org}-dependabot-errors.json`);
    await Deno.writeTextFile(
      errorsOutputPath,
      JSON.stringify(
        {
          organization: org,
          timestamp: new Date().toISOString(),
          summary: summary.errorSummary,
          errors,
        },
        null,
        2
      )
    );

    return { success: true, summary, alerts, errors };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

// CLI用のメイン処理
async function main() {
  const flags = parseArgs(Deno.args, {
    string: ["org", "output", "state", "format", "repos"],
    default: {
      output: ".output",
      state: "open",
      format: "json",
      repos: "",
    },
  });

  const org = flags.org;
  const repositories = flags.repos
    .split(",")
    .map((repo: string) => repo.trim())
    .filter((repo: string) => repo.length > 0);

  if (!org) {
    console.error(
      "使用方法: deno task start src/list-dependabot-alerts/index.ts --org=組織名 [--output=出力ディレクトリ] [--state=アラートの状態] [--format=出力形式] [--repos=REPO1,REPO2,...]"
    );
    console.error(
      "\n認証: gh auth login で認証してください"
    );
    console.error(
      "\n--reposオプションを指定しない場合は、全リポジトリが対象になります"
    );
    Deno.exit(1);
  }

  const result = await listDependabotAlerts({
    org,
    state: flags.state,
    output: flags.output,
    format: flags.format as "json" | "csv",
    repositories: repositories.length > 0 ? repositories : undefined,
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary) {
    console.log(`\n📊 サマリー:
- 検査したリポジトリ数: ${result.summary.totalRepositories}
  - アクセス可能: ${result.summary.successfulRepositories}
    - アラートあり: ${result.summary.reposWithAlerts}
    - 総アラート数: ${result.summary.totalAlerts}
      - Critical: ${result.summary.severityCounts.critical}
      - High: ${result.summary.severityCounts.high}
      - Medium: ${result.summary.severityCounts.medium}
      - Low: ${result.summary.severityCounts.low}
  - アクセス不可: ${result.summary.errorRepositories}
    - Dependabot無効: ${result.summary.errorSummary.dependabotDisabled}
    - アクセス権限なし: ${result.summary.errorSummary.noAccess}
    - その他のエラー: ${result.summary.errorSummary.otherErrors}
`);
  }
}

// TUI用の実行関数
export async function executeListDependabotAlerts(): Promise<void> {
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

    // アラート状態の選択
    const state = await Select.prompt({
      message: "Select alert state:",
      options: [
        { name: "Open", value: "open" },
        { name: "Closed", value: "closed" },
        { name: "Dismissed", value: "dismissed" },
        { name: "Fixed", value: "fixed" },
      ],
      default: "open",
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
    console.log(
      `Repositories: ${
        mode === "all"
          ? "All repositories (excluding archived)"
          : repositories?.join(", ")
      }`
    );
    console.log(`Alert State: ${state}`);
    console.log(`Output Format: ${format}`);

    const confirm = await Confirm.prompt({
      message: "Get Dependabot alerts with these settings?",
      default: true,
    });

    if (!confirm) {
      return;
    }

    const options: ListDependabotAlertsOptions = {
      org,
      state,
      format: format as "json" | "csv",
      repositories,
    };

    const result = await listDependabotAlerts(options);

    if (result.success && result.summary) {
      console.log(`\n📊 Summary:
- Total repositories: ${result.summary.totalRepositories}
- Successful: ${result.summary.successfulRepositories}
- With alerts: ${result.summary.reposWithAlerts}
- Total alerts: ${result.summary.totalAlerts}
  - Critical: ${result.summary.severityCounts.critical}
  - High: ${result.summary.severityCounts.high}
  - Medium: ${result.summary.severityCounts.medium}
  - Low: ${result.summary.severityCounts.low}
- Errors: ${result.summary.errorRepositories}
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
  listDependabotAlerts,
  type ListDependabotAlertsOptions,
  type ListDependabotAlertsResult,
};

if (import.meta.main) {
  main();
}
