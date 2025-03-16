#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write

import { parse as parseYaml } from "https://deno.land/std@0.217.0/yaml/mod.ts";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import "https://deno.land/std@0.203.0/dotenv/load.ts";
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

// CLIパラメータの処理
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
    "使用方法: deno run --allow-net --allow-env --allow-write index.ts --org=組織名 --action=アクション名 [--output=出力ディレクトリ]"
  );
  console.log(
    "例: deno run --allow-net --allow-env --allow-write index.ts --org=my-organization --action=actions/checkout"
  );
  Deno.exit(1);
}

// GitHub APIトークンの取得
const GITHUB_TOKEN = Deno.env.get("GH_TOKEN");
if (!GITHUB_TOKEN) {
  console.error(
    "エラー: GitHub APIトークンが見つかりません。GH_TOKEN環境変数を設定してください。"
  );
  Deno.exit(1);
}

/**
 * GitHub APIを使用してリクエストを行う
 */
async function githubRequest(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
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
  targetAction: string
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
          const fileInfo = await githubRequest(url);

          // ファイルの内容を取得
          const response = await fetch(fileInfo.download_url);
          const content = await response.text();
          const actionDef = parseYaml(content) as any;

          // composite actionの場合、使用しているアクションをチェック
          if (actionDef?.runs?.using === "composite") {
            const steps = actionDef?.runs?.steps || [];
            for (const step of steps) {
              if (
                step.uses &&
                (await checkActionInUses(step.uses, targetAction))
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
  targetAction: string
): Promise<ScanResult> {
  try {
    const [owner, repo] = repoFullName.split("/");

    // ワークフローファイルの内容を取得
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`;
    const fileInfo = await githubRequest(url);

    // Base64でエンコードされたコンテンツをデコード
    const content = new TextDecoder().decode(
      Uint8Array.from(atob(fileInfo.content), (c) => c.charCodeAt(0))
    );

    // YAMLとして解析
    const workflow = parseYaml(content) as any;

    // 直接または間接的な使用を追跡
    let directUsage = false;
    const indirectUsage: string[] = [];

    // ジョブとステップを確認
    if (workflow && workflow.jobs) {
      for (const [jobId, job] of Object.entries(workflow.jobs)) {
        const jobData = job as any;

        // ジョブ自体がアクションを使用している場合
        if (
          jobData.uses &&
          (await checkActionInUses(jobData.uses, targetAction))
        ) {
          directUsage = true;
        }

        // ステップを確認
        if (jobData.steps) {
          for (const step of jobData.steps) {
            if (step.uses) {
              // 直接使用されているか確認
              if (await checkActionInUses(step.uses, targetAction)) {
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
  targetAction: string
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
      const repos = await githubRequest(url);

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
            const workflowDir = await githubRequest(workflowDirUrl);

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
                  targetAction
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

/**
 * メイン関数
 */
async function main(): Promise<void> {
  if (!org || !action) {
    console.error("組織名とアクション名は必須です。");
    Deno.exit(1);
  }

  console.log(
    `📚 組織「${org}」内のアクション「${action}」の使用状況を確認中...`
  );

  const results = await scanOrganization(org, action);
  if (!results) {
    console.error(
      "スキャンに失敗しました。エラーメッセージを確認してください。"
    );
    Deno.exit(1);
  }

  // 出力ディレクトリの作成
  await ensureDir(output);
  const outputPath = join(output, `${org}-action-usage.json`);

  // 結果の集計
  const directUsageCount = results.directUsages.length;
  const indirectUsageCount = Object.values(results.indirectUsages).reduce(
    (sum, usages) => sum + usages.length,
    0
  );

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
  console.log(`\n📝 アクション使用状況を ${outputPath} に出力しました`);

  console.log(`\n📊 サマリー:
- 直接使用:
  - リポジトリ数: ${reposWithDirectUsage}
  - 使用回数: ${directUsageCount}
- 間接的な使用:
  - リポジトリ数: ${reposWithIndirectUsage}
  - 使用回数: ${indirectUsageCount}
  - 使用アクション数: ${Object.keys(results.indirectUsages).length}
`);
}

// スクリプト実行
if (import.meta.main) {
  await main();
}
