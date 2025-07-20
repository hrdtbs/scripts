import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { Octokit } from "npm:@octokit/rest@20.0.2";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";

interface SearchResult {
  repository: string;
  file: string;
  path: string;
  url: string;
  matches: SearchMatch[];
}

interface SearchMatch {
  lineNumber: number;
  line: string;
  context: string[];
}

interface SearchSummary {
  organization: string;
  query: string;
  extensions: string[];
  timestamp: string;
  summary: {
    totalRepositories: number;
    repositoriesWithMatches: number;
    totalMatches: number;
    totalFiles: number;
  };
  results: SearchResult[];
  errors: Array<{
    repository: string;
    error: string;
  }>;
}

interface SearchFilesInOrgOptions {
  org: string;
  query: string;
  extensions?: string[];
  output?: string;
  format?: "json" | "csv";
}

interface SearchFilesInOrgResult {
  success: boolean;
  summary?: {
    organization: string;
    query: string;
    extensions: string[];
    timestamp: string;
    totalRepositories: number;
    repositoriesWithMatches: number;
    totalMatches: number;
    totalFiles: number;
    errorCount: number;
    searchStats: Array<{
      extension: string;
      totalFound: number;
      retrieved: number;
      hitLimit: boolean;
    }>;
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

async function searchInOrganization(
  octokit: Octokit,
  org: string,
  query: string,
  extensions: string[]
): Promise<{
  results: SearchResult[];
  errors: Array<{ repository: string; error: string }>;
  searchStats: {
    extension: string;
    totalFound: number;
    retrieved: number;
    hitLimit: boolean;
  }[];
}> {
  const allResults: SearchResult[] = [];
  const errors: Array<{ repository: string; error: string }> = [];
  const searchStats: {
    extension: string;
    totalFound: number;
    retrieved: number;
    hitLimit: boolean;
  }[] = [];

  try {
    // 拡張子毎に検索を実行（GitHub Search APIの制限により）
    for (const extension of extensions) {
      console.log(`🔍 Searching: .${extension.replace(".", "")} files`);

      let page = 1;
      let hasNextPage = true;
      let totalFound = 0;
      let retrieved = 0;
      let hitLimit = false;

      while (hasNextPage) {
        try {
          const extensionWithoutDot = extension.replace(".", "");
          const searchQuery = `${query} org:${org} extension:${extensionWithoutDot}`;

          const { data } = await octokit.rest.search.code({
            q: searchQuery,
            per_page: 100,
            page,
            headers: {
              Accept: "application/vnd.github.v3.text-match+json",
            },
          });

          console.log(`  Page ${page}: ${data.items.length} results`);

          // 初回ページで総数を記録
          if (page === 1) {
            totalFound = data.total_count;
          }

          for (const item of data.items) {
            try {
              const repoName = item.repository.name;

              // アーカイブされたリポジトリをスキップ
              if (item.repository.archived) {
                continue;
              }

              // GitHub Search APIの結果にはテキストマッチの情報が含まれているため、
              // それを活用してファイル内容の取得を最小化
              const matches: SearchMatch[] = [];

              if (item.text_matches && item.text_matches.length > 0) {
                // テキストマッチ情報がある場合はそれを使用
                for (const textMatch of item.text_matches) {
                  if (textMatch.fragment) {
                    const lines = textMatch.fragment.split("\n");
                    lines.forEach((line, index) => {
                      if (line.toLowerCase().includes(query.toLowerCase())) {
                        matches.push({
                          lineNumber: index + 1, // 実際の行番号は取得困難なため相対位置
                          line: line.trim(),
                          context: lines.slice(
                            Math.max(0, index - 2),
                            Math.min(lines.length, index + 3)
                          ),
                        });
                      }
                    });
                  }
                }
              } else {
                // テキストマッチ情報がない場合は簡単なマッチ情報のみ作成
                matches.push({
                  lineNumber: 1,
                  line: `Match found: "${query}"`,
                  context: [`File: ${item.name}`],
                });
              }

              if (matches.length > 0) {
                allResults.push({
                  repository: repoName,
                  file: item.name,
                  path: item.path,
                  url: item.html_url,
                  matches,
                });
                retrieved++;
              }
            } catch (itemError) {
              const repoName = item.repository?.name || "unknown";
              console.warn(
                `Item processing error ${repoName}/${item.path}:`,
                itemError
              );
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
          hasNextPage = data.items.length === 100; // 結果が100件の場合は次のページがある可能性
          page++;

          // GitHub Search APIは最大1000件（10ページ）までの制限があるため、
          // それを超える場合は警告を表示
          if (page > 10) {
            console.warn(`⚠️  Search results exceed 1000 items (${extension})`);
            console.warn(
              `    Due to GitHub Search API limitations, some results may not be retrieved`
            );
            hitLimit = true;
            hasNextPage = false;
          }

          // Rate limit対策で少し待機
          if (hasNextPage) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } catch (searchError) {
          console.warn(
            `Search error (${extension}, page ${page}):`,
            searchError
          );
          errors.push({
            repository: `search-${extension}-page${page}`,
            error:
              searchError instanceof Error
                ? searchError.message
                : String(searchError),
          });
          break;
        }
      }

      // 検索統計を記録
      searchStats.push({
        extension: extension.replace(".", ""),
        totalFound,
        retrieved,
        hitLimit,
      });

      console.log(
        `  📊 ${extension}: ${retrieved}/${totalFound} items retrieved ${
          hitLimit ? "(limited)" : ""
        }`
      );

      // 拡張子間でも少し待機
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error("Organization search error:", error);
    errors.push({
      repository: "organization-search",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { results: allResults, errors, searchStats };
}

function convertToCSV(summary: SearchSummary): string {
  const headers = [
    "repository",
    "file",
    "path",
    "url",
    "lineNumber",
    "matchedLine",
    "contextBefore",
    "contextAfter",
  ];

  const rows: string[] = [];

  for (const result of summary.results) {
    for (const match of result.matches) {
      const contextLines = match.context;
      const matchIndex = contextLines.findIndex((line) =>
        line.toLowerCase().includes(summary.query.toLowerCase())
      );

      const contextBefore =
        matchIndex > 0 ? contextLines.slice(0, matchIndex).join(" | ") : "";
      const contextAfter =
        matchIndex < contextLines.length - 1
          ? contextLines.slice(matchIndex + 1).join(" | ")
          : "";

      rows.push(
        [
          result.repository,
          result.file,
          result.path,
          result.url,
          match.lineNumber.toString(),
          `"${match.line.replace(/"/g, '""')}"`,
          `"${contextBefore.replace(/"/g, '""')}"`,
          `"${contextAfter.replace(/"/g, '""')}"`,
        ].join(",")
      );
    }
  }

  return [headers.join(","), ...rows].join("\n");
}

// メインのファイル検索ロジック
async function searchFilesInOrg(
  options: SearchFilesInOrgOptions
): Promise<SearchFilesInOrgResult> {
  try {
    const {
      org,
      query,
      extensions = ["ts", "js", "tsx", "jsx"],
      output = ".output",
      format = "json",
    } = options;

    // バリデーション
    if (!org) {
      return { success: false, error: "Organization name is required" };
    }

    if (!query) {
      return { success: false, error: "Search query is required" };
    }

    if (!["json", "csv"].includes(format)) {
      return { success: false, error: "Format must be json or csv" };
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

    // 拡張子の正規化
    const normalizedExtensions = extensions.map((ext) =>
      ext.trim().startsWith(".") ? ext.trim() : `.${ext.trim()}`
    );

    console.log(`🔍 Starting search...`);
    console.log(`- Organization: ${org}`);
    console.log(`- Search query: "${query}"`);
    console.log(`- Target extensions: ${normalizedExtensions.join(", ")}`);

    // 組織全体で一括検索を実行
    console.log("🔍 Executing search across organization...");
    const {
      results: allResults,
      errors,
      searchStats,
    } = await searchInOrganization(octokit, org, query, normalizedExtensions);

    // 結果をリポジトリ毎にまとめる
    const repositoryGroups = new Map<string, SearchResult[]>();
    allResults.forEach((result) => {
      if (!repositoryGroups.has(result.repository)) {
        repositoryGroups.set(result.repository, []);
      }
      repositoryGroups.get(result.repository)!.push(result);
    });

    console.log(`\n✅ Search completed`);
    console.log(`- Total matches: ${allResults.length}`);
    console.log(`- Repositories with matches: ${repositoryGroups.size}`);

    // リポジトリ毎の詳細表示
    if (repositoryGroups.size > 0) {
      console.log(`\n📋 Repository match details:`);

      // リポジトリをマッチ数でソート（降順）
      const sortedRepositories = Array.from(repositoryGroups.entries())
        .map(([repo, results]) => ({
          repository: repo,
          fileCount: results.length,
          matchCount: results.reduce((sum, r) => sum + r.matches.length, 0),
          results,
        }))
        .sort((a, b) => b.matchCount - a.matchCount);

      sortedRepositories.forEach(
        ({ repository, fileCount, matchCount, results }) => {
          console.log(
            `  📁 ${repository}: ${matchCount} matches (${fileCount} files)`
          );

          // ファイル数が多い場合は上位5つのファイルのみ表示
          if (fileCount > 5) {
            const topFiles = results
              .sort((a, b) => b.matches.length - a.matches.length)
              .slice(0, 5);

            topFiles.forEach((result) => {
              console.log(
                `    📄 ${result.path}: ${result.matches.length} matches`
              );
            });

            if (fileCount > 5) {
              console.log(`    ... and ${fileCount - 5} more files`);
            }
          } else {
            // ファイル数が少ない場合は全て表示
            results
              .sort((a, b) => b.matches.length - a.matches.length)
              .forEach((result) => {
                console.log(
                  `    📄 ${result.path}: ${result.matches.length} matches`
                );
              });
          }
        }
      );
    }

    // 結果をまとめる
    const repositoriesWithMatches = repositoryGroups.size;
    const totalMatches = allResults.reduce(
      (sum, r) => sum + r.matches.length,
      0
    );

    const summary: SearchSummary = {
      organization: org,
      query: query,
      extensions: normalizedExtensions,
      timestamp: new Date().toISOString(),
      summary: {
        totalRepositories: repositoryGroups.size || 0,
        repositoriesWithMatches,
        totalMatches,
        totalFiles: allResults.length,
      },
      results: allResults,
      errors,
    };

    // 出力
    await ensureDir(output);
    const outputPath = join(output, `${org}-search-results.${format}`);

    if (format === "csv") {
      const csvContent = convertToCSV(summary);
      await Deno.writeTextFile(outputPath, csvContent);
    } else {
      await Deno.writeTextFile(outputPath, JSON.stringify(summary, null, 2));
    }

    const resultSummary = {
      organization: org,
      query: query,
      extensions: normalizedExtensions,
      timestamp: new Date().toISOString(),
      totalRepositories: repositoryGroups.size,
      repositoriesWithMatches,
      totalMatches,
      totalFiles: allResults.length,
      errorCount: errors.length,
      searchStats,
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
    string: ["org", "query", "extensions", "output", "format"],
    default: {
      output: ".output",
      format: "json",
      extensions: "ts,js,tsx,jsx",
    },
  });

  if (!args.org) {
    console.error("Error: --org option is required");
    Deno.exit(1);
  }

  if (!args.query) {
    console.error("Error: --query option is required");
    Deno.exit(1);
  }

  if (!["json", "csv"].includes(args.format)) {
    console.error("Error: --format option must be json or csv");
    Deno.exit(1);
  }

  const extensions = args.extensions
    .split(",")
    .map((ext) => (ext.trim().startsWith(".") ? ext.trim() : `.${ext.trim()}`));

  const result = await searchFilesInOrg({
    org: args.org,
    query: args.query,
    extensions,
    output: args.output,
    format: args.format as "json" | "csv",
  });

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    Deno.exit(1);
  }

  if (result.summary && result.outputPath) {
    // サマリーを表示
    console.log(`\n📊 Search result summary:`);
    console.log(`- Organization: ${result.summary.organization}`);
    console.log(`- Search query: "${result.summary.query}"`);
    console.log(`- Target extensions: ${result.summary.extensions.join(", ")}`);
    console.log(`- Repositories searched: ${result.summary.totalRepositories}`);
    console.log(
      `- Repositories with matches: ${result.summary.repositoriesWithMatches}`
    );
    console.log(`- Files with matches: ${result.summary.totalFiles}`);
    console.log(`- Total matches: ${result.summary.totalMatches}`);
    console.log(`- Errors: ${result.summary.errorCount}`);
    console.log(`- Output format: ${args.format}`);
    console.log(`- Output file: ${result.outputPath}`);

    // 検索統計の詳細表示
    if (result.summary.searchStats.length > 0) {
      console.log(`\n📈 Search statistics:`);
      result.summary.searchStats.forEach((stat) => {
        const status = stat.hitLimit ? "⚠️ Limited" : "✅ Complete";
        console.log(
          `  .${stat.extension}: ${stat.retrieved}/${stat.totalFound} items ${status}`
        );
      });

      const hasLimits = result.summary.searchStats.some(
        (stat) => stat.hitLimit
      );
      if (hasLimits) {
        console.log(
          `\n⚠️  Note: Some extensions hit the GitHub Search API 1000 item limit`
        );
        console.log(
          `   To get more results, make your search query more specific`
        );
      }
    }
  }
}

// TUI用の実行関数
export async function executeSearchFilesInOrg(): Promise<void> {
  const { Input, Select } = await import(
    "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts"
  );

  try {
    // 組織名の入力
    const org = await Input.prompt({
      message: "Enter organization name:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Organization name is required",
    });

    // 検索クエリの入力
    const query = await Input.prompt({
      message: "Enter search query:",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "Search query is required",
    });

    // 拡張子の入力
    const extensionsInput = await Input.prompt({
      message: "Enter file extensions (comma-separated, e.g., ts,js,tsx,jsx):",
      default: "ts,js,tsx,jsx",
      validate: (value: string) =>
        value.trim().length > 0 ? true : "File extensions are required",
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

    // 拡張子の正規化
    const extensions = extensionsInput
      .split(",")
      .map((ext) =>
        ext.trim().startsWith(".") ? ext.trim() : `.${ext.trim()}`
      );

    // 設定内容の確認
    console.log("\n📋 Settings:");
    console.log(`Organization: ${org}`);
    console.log(`Search Query: "${query}"`);
    console.log(`File Extensions: ${extensions.join(", ")}`);
    console.log(`Output Format: ${format}`);

    const options: SearchFilesInOrgOptions = {
      org,
      query,
      extensions,
      format: format as "json" | "csv",
    };

    const result = await searchFilesInOrg(options);

    if (result.success && result.summary && result.outputPath) {
      console.log(
        `\n📝 Search results have been output to ${result.outputPath}`
      );

      console.log(`\n📊 Summary:`);
      console.log(`- Organization: ${result.summary.organization}`);
      console.log(`- Search query: "${result.summary.query}"`);
      console.log(
        `- Target extensions: ${result.summary.extensions.join(", ")}`
      );
      console.log(
        `- Repositories searched: ${result.summary.totalRepositories}`
      );
      console.log(
        `- Repositories with matches: ${result.summary.repositoriesWithMatches}`
      );
      console.log(`- Files with matches: ${result.summary.totalFiles}`);
      console.log(`- Total matches: ${result.summary.totalMatches}`);
      console.log(`- Errors: ${result.summary.errorCount}`);
      console.log(`- Output format: ${format}`);
      console.log(`- Output file: ${result.outputPath}`);

      // 検索統計の詳細表示
      if (result.summary.searchStats.length > 0) {
        console.log(`\n📈 Search statistics:`);
        result.summary.searchStats.forEach((stat) => {
          const status = stat.hitLimit ? "⚠️ Limited" : "✅ Complete";
          console.log(
            `  .${stat.extension}: ${stat.retrieved}/${stat.totalFound} items ${status}`
          );
        });

        const hasLimits = result.summary.searchStats.some(
          (stat) => stat.hitLimit
        );
        if (hasLimits) {
          console.log(
            `\n⚠️  Note: Some extensions hit the GitHub Search API 1000 item limit`
          );
          console.log(
            `   To get more results, make your search query more specific`
          );
        }
      }
    } else {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Export functions for TUI
export {
  searchFilesInOrg,
  type SearchFilesInOrgOptions,
  type SearchFilesInOrgResult,
};

if (import.meta.main) {
  main();
}
