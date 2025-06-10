import { parse } from "https://deno.land/std@0.210.0/flags/mod.ts";
import { Octokit } from "npm:@octokit/rest@22.0.0";
import "https://deno.land/std@0.210.0/dotenv/load.ts";

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

async function main() {
  const args = parse(Deno.args, {
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
GitHub組織の複数リポジトリにIssueを一括作成するツール

使用方法:
  deno run --allow-net --allow-read --allow-write --allow-env \\
    src/create-issues-bulk/index.ts \\
    --org=organization \\
    --repos=repo1,repo2,repo3 \\
    --title="Issue タイトル" \\
    --body="Issue 本文" \\
    [オプション]

必須オプション:
  --org        対象の組織名
  --repos      対象リポジトリ名（カンマ区切り）
  --title      作成するIssueのタイトル
  --body       作成するIssueの本文

オプション:
  --labels     追加するラベル（カンマ区切り）
  --assignees  アサインするユーザー（カンマ区切り）
  --output     出力ディレクトリ（デフォルト: .output）
  --format     出力形式 json|csv（デフォルト: json）
  --help       このヘルプを表示

例:
  deno run --allow-net --allow-read --allow-write --allow-env \\
    src/create-issues-bulk/index.ts \\
    --org=myorg \\
    --repos=frontend,backend,docs \\
    --title="セキュリティアップデート" \\
    --body="依存関係のセキュリティアップデートを実施してください。" \\
    --labels=security,maintenance \\
    --assignees=user1,user2

環境変数:
  GH_TOKEN     GitHub Personal Access Token (必須)
`);
    Deno.exit(0);
  }

  if (!args.org) {
    console.error("エラー: --org オプションは必須です");
    console.error("ヘルプを表示するには --help オプションを使用してください");
    Deno.exit(1);
  }

  if (!args.repos) {
    console.error("エラー: --repos オプションは必須です");
    console.error("例: --repos=repo1,repo2,repo3");
    console.error("ヘルプを表示するには --help オプションを使用してください");
    Deno.exit(1);
  }

  if (!args.title) {
    console.error("エラー: --title オプションは必須です");
    console.error("ヘルプを表示するには --help オプションを使用してください");
    Deno.exit(1);
  }

  if (!args.body) {
    console.error("エラー: --body オプションは必須です");
    console.error("ヘルプを表示するには --help オプションを使用してください");
    Deno.exit(1);
  }

  if (!["json", "csv"].includes(args.format)) {
    console.error(
      "エラー: --format オプションはjsonまたはcsvを指定してください"
    );
    Deno.exit(1);
  }

  const repositories = args.repos.split(",").map((repo) => repo.trim());
  const labels = args.labels
    ? args.labels.split(",").map((label) => label.trim())
    : undefined;
  const assignees = args.assignees
    ? args.assignees.split(",").map((assignee) => assignee.trim())
    : undefined;

  console.log(`🚀 Issue一括作成開始...`);
  console.log(`- 組織: ${args.org}`);
  console.log(`- 対象リポジトリ数: ${repositories.length}`);
  console.log(`- タイトル: "${args.title}"`);
  console.log(
    `- 本文: "${args.body.substring(0, 50)}${
      args.body.length > 50 ? "..." : ""
    }"`
  );
  if (labels && labels.length > 0) {
    console.log(`- ラベル: ${labels.join(", ")}`);
  }
  if (assignees && assignees.length > 0) {
    console.log(`- アサイニー: ${assignees.join(", ")}`);
  }

  const octokit = new Octokit({
    auth: Deno.env.get("GH_TOKEN"),
  });

  const results: IssueCreationResult[] = [];
  const errors: Array<{ repository: string; error: string }> = [];
  let successCount = 0;

  // 各リポジトリにIssueを作成
  for (let i = 0; i < repositories.length; i++) {
    const repo = repositories[i];
    console.log(`\n📝 Issue作成中: ${repo} (${i + 1}/${repositories.length})`);

    try {
      const result = await createIssueInRepository(
        octokit,
        args.org,
        repo,
        args.title,
        args.body,
        labels,
        assignees
      );

      results.push(result);

      if (result.success) {
        console.log(`  ✅ 作成成功: Issue #${result.issueNumber}`);
        console.log(`  🔗 URL: ${result.issueUrl}`);
        successCount++;
      } else {
        console.log(`  ❌ 作成失敗: ${result.error}`);
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
      console.log(`  ❌ エラー: ${errorMessage}`);

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
    organization: args.org,
    repositories,
    title: args.title,
    timestamp: new Date().toISOString(),
    summary: {
      totalRepositories: repositories.length,
      successfulCreations: successCount,
      failedCreations: repositories.length - successCount,
    },
    results,
    errors,
  };

  // 出力
  const outputDir = args.output;
  await Deno.mkdir(outputDir, { recursive: true });

  const extension = args.format;
  const outputPath = `${outputDir}/${args.org}-issue-creation-results.${extension}`;

  if (args.format === "csv") {
    const csvContent = convertToCSV(summary);
    await Deno.writeTextFile(outputPath, csvContent);
  } else {
    await Deno.writeTextFile(outputPath, JSON.stringify(summary, null, 2));
  }

  // サマリーを表示
  console.log(`\n📊 Issue作成結果サマリー:`);
  console.log(`- 組織: ${args.org}`);
  console.log(`- 対象リポジトリ数: ${repositories.length}`);
  console.log(`- 成功: ${successCount} 件`);
  console.log(`- 失敗: ${repositories.length - successCount} 件`);
  console.log(`- 出力形式: ${args.format}`);
  console.log(`- 出力ファイル: ${outputPath}`);

  // 成功したリポジトリの詳細
  if (successCount > 0) {
    console.log(`\n✅ 成功したリポジトリ:`);
    results
      .filter((r) => r.success)
      .forEach((result) => {
        console.log(`  📁 ${result.repository}: Issue #${result.issueNumber}`);
        console.log(`      ${result.issueUrl}`);
      });
  }

  // エラーが発生したリポジトリの詳細
  if (errors.length > 0) {
    console.log(`\n❌ エラーが発生したリポジトリ:`);
    errors.forEach((error) => {
      console.log(`  📁 ${error.repository}: ${error.error}`);
    });
  }

  if (successCount === repositories.length) {
    console.log(`\n🎉 全てのリポジトリでIssue作成が完了しました！`);
  } else if (successCount > 0) {
    console.log(`\n⚠️  一部のリポジトリでIssue作成が失敗しました`);
  } else {
    console.log(`\n💥 全てのリポジトリでIssue作成が失敗しました`);
    Deno.exit(1);
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

if (import.meta.main) {
  main();
}
