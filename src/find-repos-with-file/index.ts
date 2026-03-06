import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { Octokit } from "npm:@octokit/rest@20.0.2";
import { getGitHubToken } from "../../utils/github-token.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";

interface RepositoryWithFile {
  repository: string;
  filePath: string;
  url: string;
  size: number | undefined;
  lastModified: string | null | undefined;
  isArchived: boolean;
}

interface FindReposWithFileSummary {
  organization: string;
  fileName: string;
  timestamp: string;
  summary: {
    totalRepositories: number;
    repositoriesWithFile: number;
    totalFiles: number;
  };
  results: RepositoryWithFile[];
  errors: Array<{
    repository: string;
    error: string;
  }>;
}

interface FindReposWithFileOptions {
  org: string;
  fileName: string;
  output?: string;
  format?: "json" | "csv";
  includeArchived?: boolean;
}

interface FindReposWithFileResult {
  success: boolean;
  summary?: {
    organization: string;
    fileName: string;
    timestamp: string;
    totalRepositories: number;
    repositoriesWithFile: number;
    totalFiles: number;
    errorCount: number;
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

async function findRepositoriesWithFile(
  octokit: Octokit,
  org: string,
  fileName: string,
  includeArchived: boolean = false
): Promise<{
  results: RepositoryWithFile[];
  errors: Array<{ repository: string; error: string }>;
}> {
  const allResults: RepositoryWithFile[] = [];
  const errors: Array<{ repository: string; error: string }> = [];
  const processedRepos = new Set<string>();

  try {
    console.log(`🔍 Searching for path: ${fileName}`);
    console.log(`📁 Organization: ${org}`);
    console.log(`📦 Include archived: ${includeArchived ? "Yes" : "No"}`);

    // GitHub Search APIを使用してファイルを検索
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      try {
        // パス検索クエリを構築
        // GitHub Search APIでは、より具体的な検索クエリの方が効率的
        let searchQuery: string;
        if (fileName.includes("*") || fileName.includes("?")) {
          // ワイルドカードパターンの場合はfilenameクエリを使用
          searchQuery = `filename:${fileName} org:${org}`;
        } else if (fileName.includes("/")) {
          // パスが含まれている場合はpathクエリを使用
          searchQuery = `path:${fileName} org:${org}`;
        } else {
          // ファイル名のみの場合はfilenameクエリを使用
          searchQuery = `filename:${fileName} org:${org}`;
        }

        console.log(`  Search query: ${searchQuery}`);

        const { data } = await octokit.rest.search.code({
          q: searchQuery,
          per_page: 100,
          page,
          headers: {
            Accept: "application/vnd.github.v3.text-match+json",
          },
        });

        console.log(`  Page ${page}: ${data.items.length} results`);

        for (const item of data.items) {
          try {
            const repoName = item.repository.name;
            const repoFullName = item.repository.full_name;

            // 重複チェック
            if (processedRepos.has(repoFullName)) {
              continue;
            }

            // アーカイブされたリポジトリの処理
            if (item.repository.archived && !includeArchived) {
              continue;
            }

            // リポジトリ情報を取得（将来の拡張用）
            // const repoInfo = await octokit.rest.repos.get({
            //   owner: org,
            //   repo: repoName,
            // });

            const repositoryWithFile: RepositoryWithFile = {
              repository: repoName,
              filePath: item.path,
              url: item.html_url,
              size: (item as typeof item & { size?: number }).size,
              lastModified: item.repository.updated_at,
              isArchived: item.repository.archived || false,
            };

            allResults.push(repositoryWithFile);
            processedRepos.add(repoFullName);

            console.log(`  ✅ Found: ${repoName}/${item.path}`);
          } catch (itemError) {
            const repoName = item.repository?.name || "unknown";
            console.warn(`Item processing error ${repoName}:`, itemError);
            errors.push({
              repository: repoName,
              error:
                itemError instanceof Error
                  ? itemError.message
                  : String(itemError),
            });
          }
        }

        // ページネーション制御
        hasNextPage = data.items.length === 100;
        page++;

        // GitHub Search APIは最大1000件（10ページ）までの制限
        if (page > 10) {
          console.warn(`⚠️  Search results exceed 1000 items`);
          console.warn(
            `    Due to GitHub Search API limitations, some results may not be retrieved`
          );
          hasNextPage = false;
        }

        // Rate limit対策で少し待機
        if (hasNextPage) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (searchError) {
        console.warn(`Search error (page ${page}):`, searchError);
        errors.push({
          repository: `search-page${page}`,
          error:
            searchError instanceof Error
              ? searchError.message
              : String(searchError),
        });
        break;
      }
    }
  } catch (error) {
    console.error("Search error:", error);
    errors.push({
      repository: "search-operation",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { results: allResults, errors };
}

function convertToCSV(summary: FindReposWithFileSummary): string {
  const headers = [
    "repository",
    "filePath",
    "url",
    "size",
    "lastModified",
    "isArchived",
  ];

  const rows: string[] = [];

  for (const result of summary.results) {
    rows.push(
      [
        result.repository,
        result.filePath,
        result.url,
        String(result.size ?? ""),
        result.lastModified,
        result.isArchived.toString(),
      ].join(",")
    );
  }

  return [headers.join(","), ...rows].join("\n");
}

// メインのファイル検索ロジック
async function findReposWithFile(
  options: FindReposWithFileOptions
): Promise<FindReposWithFileResult> {
  try {
    const {
      org,
      fileName,
      output = ".output",
      format = "json",
      includeArchived = false,
    } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
    }

    if (!fileName) {
      return { success: false, error: "File name is required" };
    }

    if (!["json", "csv"].includes(format)) {
      return { success: false, error: "Format must be json or csv" };
    }

    const token = await getGitHubToken();
    const octokit = createOctokit(token);

    console.log(`🔍 Starting search...`);
    console.log(`- Organization: ${org}`);
    console.log(`- File path: "${fileName}"`);
    console.log(`- Include archived: ${includeArchived}`);

    // ファイル検索を実行
    console.log("🔍 Executing search...");
    const { results, errors } = await findRepositoriesWithFile(
      octokit,
      org,
      fileName,
      includeArchived
    );

    console.log(`\n✅ Search completed`);
    console.log(`- Total repositories found: ${results.length}`);
    console.log(`- Errors: ${errors.length}`);

    // 結果の詳細表示
    if (results.length > 0) {
      console.log(`\n📋 Repositories with path "${fileName}":`);

      // リポジトリを名前でソート
      const sortedResults = results.sort((a, b) =>
        a.repository.localeCompare(b.repository)
      );

      sortedResults.forEach((result) => {
        const archivedStatus = result.isArchived ? " (Archived)" : "";
        console.log(`${result.repository}${archivedStatus}`);
      });
    } else {
      console.log(`\n❌ No repositories found containing path "${fileName}"`);
    }

    // 結果をまとめる
    const summary: FindReposWithFileSummary = {
      organization: org,
      fileName: fileName,
      timestamp: new Date().toISOString(),
      summary: {
        totalRepositories: results.length,
        repositoriesWithFile: results.length,
        totalFiles: results.length,
      },
      results,
      errors,
    };

    // 出力
    await ensureDir(output);
    const outputPath = join(
      output,
      `${org}-repos-with-${fileName.replace(/[^a-zA-Z0-9]/g, "-")}.${format}`
    );

    if (format === "csv") {
      const csvContent = convertToCSV(summary);
      await Deno.writeTextFile(outputPath, csvContent);
    } else {
      await Deno.writeTextFile(outputPath, JSON.stringify(summary, null, 2));
    }

    const resultSummary = {
      organization: org,
      fileName: fileName,
      timestamp: new Date().toISOString(),
      totalRepositories: results.length,
      repositoriesWithFile: results.length,
      totalFiles: results.length,
      errorCount: errors.length,
    };

    return { success: true, summary: resultSummary, outputPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

// CLI用のメイン処理
async function main() {
  const args = parseArgs(Deno.args, {
    string: ["org", "fileName", "output", "format"],
    boolean: ["includeArchived"],
    default: {
      output: ".output",
      format: "json",
      includeArchived: false,
    },
  });

  if (!args.org) {
    console.error("Error: --org option is required");
    Deno.exit(1);
  }

  if (!args.fileName) {
    console.error("Error: --fileName option is required");
    Deno.exit(1);
  }

  if (!["json", "csv"].includes(args.format)) {
    console.error("Error: --format option must be json or csv");
    Deno.exit(1);
  }

  const result = await findReposWithFile({
    org: args.org,
    fileName: args.fileName,
    output: args.output,
    format: args.format as "json" | "csv",
    includeArchived: args.includeArchived,
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary && result.outputPath) {
    // サマリーを表示
    console.log(`\n📊 Search result summary:`);
    console.log(`- Organization: ${result.summary.organization}`);
    console.log(`- File path: "${result.summary.fileName}"`);
    console.log(`- Repositories found: ${result.summary.repositoriesWithFile}`);
    console.log(`- Total files: ${result.summary.totalFiles}`);
    console.log(`- Errors: ${result.summary.errorCount}`);
    console.log(`- Output format: ${args.format}`);
    console.log(`- Output file: ${result.outputPath}`);
  }
}

// TUI用の実行関数
export async function executeFindReposWithFile(): Promise<void> {
  const { Input, Select, Confirm } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts"
  );

  try {
    // 組織名の入力
    const org = await Input.prompt({
      message: "Enter organization name:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Organization name is required",
    });

    // ファイルパスの入力
    const fileName = await Input.prompt({
      message:
        "Enter file path to search for (e.g., package.json, src/index.ts, *.config.js, **/Dockerfile):",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "File path is required",
    });

    // アーカイブされたリポジトリを含むかどうか
    const includeArchived = await Confirm.prompt({
      message: "Include archived repositories?",
      default: false,
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
    console.log(`File path: "${fileName}"`);
    console.log(`Include archived: ${includeArchived}`);
    console.log(`Output format: ${format}`);

    const options: FindReposWithFileOptions = {
      org,
      fileName,
      includeArchived,
      format: format as "json" | "csv",
    };

    const result = await findReposWithFile(options);

    if (result.success && result.summary && result.outputPath) {
      console.log(
        `\n📝 Search results have been output to ${result.outputPath}`
      );

      console.log(`\n📊 Summary:`);
      console.log(`- Organization: ${result.summary.organization}`);
      console.log(`- File path: "${result.summary.fileName}"`);
      console.log(
        `- Repositories found: ${result.summary.repositoriesWithFile}`
      );
      console.log(`- Total files: ${result.summary.totalFiles}`);
      console.log(`- Errors: ${result.summary.errorCount}`);
      console.log(`- Output format: ${format}`);
      console.log(`- Output file: ${result.outputPath}`);
    } else {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Export functions for TUI
export {
  findReposWithFile,
  type FindReposWithFileOptions,
  type FindReposWithFileResult,
};

if (import.meta.main) {
  main();
}
