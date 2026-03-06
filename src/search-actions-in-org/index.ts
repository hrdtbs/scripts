#!/usr/bin/env -S deno run --allow-net --allow-read --allow-run=gh

import { parse as parseYaml } from "https://deno.land/std@0.217.0/yaml/mod.ts";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import { getGitHubToken } from "../../utils/github-token.ts";

/**
 * 指定された組織内のリポジトリをスキャンして、特定のGitHub Actionが
 * 直接または間接的に使用されているかどうかを確認する。
 */

// 型定義
interface WorkflowUsage {
  repo: string;
  workflow: string;
}

interface ScanResult {
  direct: boolean;
  indirect: string[];
}

interface ScanResults {
  organization: string;
  timestamp: string;
  targetAction: string;
  summary: {
    totalRepositories: number;
    repositoriesScanned: number;
    repositoriesWithDirectUsage: number;
    repositoriesWithIndirectUsage: number;
    totalDirectUsages: number;
    totalIndirectUsages: number;
  };
  directUsages: WorkflowUsage[];
  indirectUsages: Record<string, WorkflowUsage[]>;
  errors: {
    accessErrors: string[];
    scanErrors: string[];
  };
}

interface SearchActionsInOrgOptions {
  org: string;
  action: string;
  output?: string;
}

interface SearchActionsInOrgResult {
  success: boolean;
  summary?: {
    organization: string;
    timestamp: string;
    targetAction: string;
    totalRepositories: number;
    repositoriesScanned: number;
    repositoriesWithDirectUsage: number;
    repositoriesWithIndirectUsage: number;
    totalDirectUsages: number;
    totalIndirectUsages: number;
    indirectActionCount: number;
  };
  outputPath?: string;
  error?: string;
}

/**
 * GitHub APIを使用してリクエストを行う
 */
// deno-lint-ignore no-explicit-any
async function githubRequest(url: string, token: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "deno-github-action-scanner",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
}

/**
 * アクションが対象のアクションを使用しているかチェックする
 */
async function checkActionInUses(
  usesValue: string,
  targetAction: string,
  token: string
): Promise<boolean> {
  // 完全一致または@バージョン指定の場合
  if (
    usesValue === targetAction ||
    usesValue.match(new RegExp(`^${escapeRegExp(targetAction)}@`))
  ) {
    return true;
  }

  // Docker形式の場合はスキップ
  if (usesValue.startsWith("docker://")) {
    return false;
  }

  // アクションのリポジトリ情報を取得
  if (usesValue && usesValue.includes("/") && !usesValue.startsWith("./")) {
    try {
      // バージョン情報を削除
      const actionRepo = usesValue.split("@")[0];

      // ローカルアクションの場合はスキップ
      if (actionRepo.startsWith("./") || actionRepo.startsWith("../")) {
        return false;
      }

      // composite actionの場合は action.yml または action.yaml を確認
      const [actionOwner, actionRepoName] = actionRepo.split("/", 2);

      for (const fileName of ["action.yml", "action.yaml"]) {
        try {
          const url = `https://api.github.com/repos/${actionOwner}/${actionRepoName}/contents/${fileName}`;
          const fileInfo = await githubRequest(url, token);

          // ファイルの内容を取得
          const response = await fetch(fileInfo.download_url);
          const content = await response.text();
          // deno-lint-ignore no-explicit-any
          const actionDef = parseYaml(content) as any;

          // composite actionの場合、使用しているアクションをチェック
          if (actionDef?.runs?.using === "composite") {
            const steps = actionDef?.runs?.steps || [];
            for (const step of steps) {
              if (
                step.uses &&
                (await checkActionInUses(step.uses, targetAction, token))
              ) {
                return true;
              }
            }
          }

          break;
        } catch (error) {
          if (!(error instanceof Error && error.message.includes("404"))) {
            console.warn(
              `Warning: Failed to check file ${fileName} for action ${actionRepo}: ${error}`
            );
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Error checking action ${usesValue}: ${error}`);
    }
  }

  return false;
}

/**
 * ワークフローファイルを解析して対象のアクションが使用されているか確認する
 */
async function scanWorkflowFile(
  repoFullName: string,
  workflowPath: string,
  targetAction: string,
  token: string
): Promise<ScanResult> {
  try {
    const [owner, repo] = repoFullName.split("/");

    // ワークフローファイルの内容を取得
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`;
    const fileInfo = await githubRequest(url, token);

    // Base64でエンコードされたコンテンツをデコード
    const content = new TextDecoder().decode(
      Uint8Array.from(atob(fileInfo.content), (c) => c.charCodeAt(0))
    );

    // YAMLとして解析
    // deno-lint-ignore no-explicit-any
    const workflow = parseYaml(content) as any;

    // 直接または間接的な使用を追跡
    let directUsage = false;
    const indirectUsage: string[] = [];

    // ジョブとステップを確認
    if (workflow && workflow.jobs) {
      for (const [_jobId, job] of Object.entries(workflow.jobs)) {
        // deno-lint-ignore no-explicit-any
        const jobData = job as any;

        // ジョブ自体がアクションを使用している場合
        if (
          jobData.uses &&
          (await checkActionInUses(jobData.uses, targetAction, token))
        ) {
          directUsage = true;
        }

        // ステップを確認
        if (jobData.steps) {
          for (const step of jobData.steps) {
            if (step.uses) {
              // 直接使用されているか確認
              if (await checkActionInUses(step.uses, targetAction, token)) {
                directUsage = true;
              }
              // 間接的に使用されている可能性がある場合は記録
              else if (step.uses.includes("/") && !step.uses.startsWith("./")) {
                indirectUsage.push(step.uses);
              }
            }
          }
        }
      }
    }

    return {
      direct: directUsage,
      indirect: indirectUsage,
    };
  } catch (error) {
    console.error(
      `Error scanning workflow file ${workflowPath} in ${repoFullName}: ${error}`
    );
    return { direct: false, indirect: [] };
  }
}

/**
 * 組織内のすべてのリポジトリのワークフローを走査する
 */
async function scanOrganization(
  orgName: string,
  targetAction: string,
  token: string
): Promise<ScanResults | null> {
  try {
    // 結果を格納するオブジェクト
    const results: ScanResults = {
      organization: orgName,
      timestamp: new Date().toISOString(),
      targetAction: targetAction,
      summary: {
        totalRepositories: 0,
        repositoriesScanned: 0,
        repositoriesWithDirectUsage: 0,
        repositoriesWithIndirectUsage: 0,
        totalDirectUsages: 0,
        totalIndirectUsages: 0,
      },
      directUsages: [],
      indirectUsages: {},
      errors: {
        accessErrors: [],
        scanErrors: [],
      },
    };

    console.log(`Scanning ${orgName} organization...`);

    // 組織のリポジトリを取得（ページネーション対応）
    let page = 1;
    let hasMoreRepos = true;

    while (hasMoreRepos) {
      const url = `https://api.github.com/orgs/${orgName}/repos?per_page=100&page=${page}`;
      const repos = await githubRequest(url, token);

      if (repos.length === 0) {
        hasMoreRepos = false;
        continue;
      }

      // 各リポジトリを処理
      for (const repo of repos) {
        try {
          console.log(`Checking repository: ${repo.full_name}`);

          // .github/workflowsディレクトリの内容を取得
          try {
            const workflowDirUrl = `https://api.github.com/repos/${repo.full_name}/contents/.github/workflows`;
            const workflowDir = await githubRequest(workflowDirUrl, token);

            // 各ワークフローファイルをスキャン
            for (const content of workflowDir) {
              if (
                content.name.endsWith(".yml") ||
                content.name.endsWith(".yaml")
              ) {
                console.log(`  Scanning workflow: ${content.path}`);
                const scanResult = await scanWorkflowFile(
                  repo.full_name,
                  content.path,
                  targetAction,
                  token
                );

                // 直接使用されている場合
                if (scanResult.direct) {
                  results.directUsages.push({
                    repo: repo.full_name,
                    workflow: content.path,
                  });
                  results.summary.repositoriesWithDirectUsage++;
                  results.summary.totalDirectUsages++;
                }

                // 間接的な使用の可能性がある場合
                for (const indirectAction of scanResult.indirect) {
                  if (!results.indirectUsages[indirectAction]) {
                    results.indirectUsages[indirectAction] = [];
                    results.summary.repositoriesWithIndirectUsage++;
                  }
                  results.indirectUsages[indirectAction].push({
                    repo: repo.full_name,
                    workflow: content.path,
                  });
                  results.summary.totalIndirectUsages++;
                }
              }
            }
          } catch (error) {
            if (error instanceof Error && error.message.includes("404")) {
              console.log(`No workflows found in ${repo.full_name}`);
            } else {
              console.error(
                `Error accessing workflows in ${repo.full_name}: ${error}`
              );
              results.errors.accessErrors.push(repo.full_name);
            }
          }
        } catch (error) {
          console.error(
            `Error processing repository ${repo.full_name}: ${error}`
          );
          results.errors.scanErrors.push(repo.full_name);
        }
      }

      results.summary.repositoriesScanned = page;
      page++;
    }

    results.summary.totalRepositories = results.summary.repositoriesScanned;

    return results;
  } catch (error) {
    console.error(`Error scanning organization ${orgName}: ${error}`);
    return null;
  }
}

/**
 * 正規表現でエスケープが必要な文字をエスケープする
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// メインのアクション検索ロジック
async function searchActionsInOrg(
  options: SearchActionsInOrgOptions
): Promise<SearchActionsInOrgResult> {
  try {
    const { org, action, output = ".output" } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
    }

    if (!action) {
      return { success: false, error: "Action name is required" };
    }

    const token = await getGitHubToken();

    console.log(
      `📚 Scanning organization "${org}" for action "${action}" usage...`
    );

    const results = await scanOrganization(org, action, token);
    if (!results) {
      return {
        success: false,
        error: "Failed to scan organization. Please check error messages.",
      };
    }

    // 出力ディレクトリの作成
    await ensureDir(output);
    const outputPath = join(output, `${org}-action-usage.json`);

    // 結果の集計
    const reposWithDirectUsage = new Set(
      results.directUsages.map((usage) => usage.repo)
    ).size;

    const reposWithIndirectUsage = new Set(
      Object.values(results.indirectUsages)
        .flat()
        .map((usage) => usage.repo)
    ).size;

    // JSON出力の作成
    const jsonContent = JSON.stringify(
      {
        organization: org,
        timestamp: new Date().toISOString(),
        targetAction: action,
        summary: {
          totalRepositories: results.summary.totalRepositories,
          repositoriesScanned: results.summary.repositoriesScanned,
          repositoriesWithDirectUsage: reposWithDirectUsage,
          repositoriesWithIndirectUsage: reposWithIndirectUsage,
          totalDirectUsages: results.summary.totalDirectUsages,
          totalIndirectUsages: results.summary.totalIndirectUsages,
        },
        directUsages: results.directUsages,
        indirectUsages: results.indirectUsages,
        errors: {
          accessErrors: results.errors.accessErrors,
          scanErrors: results.errors.scanErrors,
        },
      },
      null,
      2
    );

    await Deno.writeTextFile(outputPath, jsonContent);

    const summary = {
      organization: org,
      timestamp: new Date().toISOString(),
      targetAction: action,
      totalRepositories: results.summary.totalRepositories,
      repositoriesScanned: results.summary.repositoriesScanned,
      repositoriesWithDirectUsage: reposWithDirectUsage,
      repositoriesWithIndirectUsage: reposWithIndirectUsage,
      totalDirectUsages: results.summary.totalDirectUsages,
      totalIndirectUsages: results.summary.totalIndirectUsages,
      indirectActionCount: Object.keys(results.indirectUsages).length,
    };

    return { success: true, summary, outputPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

// CLI用のメイン処理
async function main(): Promise<void> {
  const flags = parseArgs(Deno.args, {
    string: ["org", "action", "output"],
    default: {
      output: ".output",
    },
  });

  const org = flags.org;
  const action = flags.action;
  const output = flags.output as string;

  if (!org || !action) {
    console.log(
      "Usage: deno run --allow-net --allow-env --allow-write index.ts --org=organization --action=action-name [--output=output-directory]"
    );
    console.log(
      "Example: deno run --allow-net --allow-env --allow-write index.ts --org=my-organization --action=actions/checkout"
    );
    Deno.exit(1);
  }

  const result = await searchActionsInOrg({
    org,
    action,
    output,
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary && result.outputPath) {
    console.log(`\n📝 Action usage has been output to ${result.outputPath}`);

    console.log(`\n📊 Summary:
- Direct usage:
  - Repositories: ${result.summary.repositoriesWithDirectUsage}
  - Usage count: ${result.summary.totalDirectUsages}
- Indirect usage:
  - Repositories: ${result.summary.repositoriesWithIndirectUsage}
  - Usage count: ${result.summary.totalIndirectUsages}
  - Action count: ${result.summary.indirectActionCount}
`);
  }
}

// TUI用の実行関数
export async function executeSearchActionsInOrg(): Promise<void> {
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

    // アクション名の入力
    const action = await Input.prompt({
      message: "Enter action name (e.g., actions/checkout):",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Action name is required",
    });

    // 設定内容の確認
    console.log("\n📋 Settings:");
    console.log(`Organization: ${org}`);
    console.log(`Target Action: ${action}`);

    const options: SearchActionsInOrgOptions = {
      org,
      action,
    };

    const result = await searchActionsInOrg(options);

    if (result.success && result.summary && result.outputPath) {
      console.log(`\n📝 Action usage has been output to ${result.outputPath}`);

      console.log(`\n📊 Summary:
- Direct usage:
  - Repositories: ${result.summary.repositoriesWithDirectUsage}
  - Usage count: ${result.summary.totalDirectUsages}
- Indirect usage:
  - Repositories: ${result.summary.repositoriesWithIndirectUsage}
  - Usage count: ${result.summary.totalIndirectUsages}
  - Action count: ${result.summary.indirectActionCount}
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
  searchActionsInOrg,
  type SearchActionsInOrgOptions,
  type SearchActionsInOrgResult,
};

if (import.meta.main) {
  main();
}
