import { parse } from "https://deno.land/std@0.210.0/flags/mod.ts";
import { Octokit } from "npm:@octokit/rest@20.0.2";
import "https://deno.land/std@0.210.0/dotenv/load.ts";

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
      console.log(`🔍 検索中: .${extension.replace(".", "")} ファイル`);

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

          console.log(`  ページ ${page}: ${data.items.length} 件の結果`);

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
                  line: `マッチが見つかりました: "${query}"`,
                  context: [`ファイル: ${item.name}`],
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
                `アイテム処理エラー ${repoName}/${item.path}:`,
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
            console.warn(`⚠️  検索結果が1000件を超えています (${extension})`);
            console.warn(
              `    GitHub Search APIの制限により、一部結果が取得できません`
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
            `検索エラー (${extension}, ページ ${page}):`,
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
        `  📊 ${extension}: ${retrieved}/${totalFound} 件取得 ${
          hitLimit ? "(制限あり)" : ""
        }`
      );

      // 拡張子間でも少し待機
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error("組織検索エラー:", error);
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

async function main() {
  const args = parse(Deno.args, {
    string: ["org", "query", "extensions", "output", "format"],
    default: {
      output: ".output",
      format: "json",
      extensions: "ts,js,tsx,jsx",
    },
  });

  if (!args.org) {
    console.error("エラー: --org オプションは必須です");
    Deno.exit(1);
  }

  if (!args.query) {
    console.error("エラー: --query オプションは必須です");
    Deno.exit(1);
  }

  if (!["json", "csv"].includes(args.format)) {
    console.error(
      "エラー: --format オプションはjsonまたはcsvを指定してください"
    );
    Deno.exit(1);
  }

  const extensions = args.extensions
    .split(",")
    .map((ext) => (ext.trim().startsWith(".") ? ext.trim() : `.${ext.trim()}`));

  console.log(`🔍 検索開始...`);
  console.log(`- 組織: ${args.org}`);
  console.log(`- 検索クエリ: "${args.query}"`);
  console.log(`- 対象拡張子: ${extensions.join(", ")}`);

  const octokit = new Octokit({
    auth: Deno.env.get("GH_TOKEN"),
  });

  try {
    // 組織全体で一括検索を実行
    console.log("🔍 組織全体で検索を実行中...");
    const {
      results: allResults,
      errors,
      searchStats,
    } = await searchInOrganization(octokit, args.org, args.query, extensions);

    // 結果をリポジトリ毎にまとめる
    const repositoryGroups = new Map<string, SearchResult[]>();
    allResults.forEach((result) => {
      if (!repositoryGroups.has(result.repository)) {
        repositoryGroups.set(result.repository, []);
      }
      repositoryGroups.get(result.repository)!.push(result);
    });

    console.log(`\n✅ 検索完了`);
    console.log(`- 総マッチ数: ${allResults.length}`);
    console.log(`- マッチしたリポジトリ数: ${repositoryGroups.size}`);

    // リポジトリ毎の詳細表示
    if (repositoryGroups.size > 0) {
      console.log(`\n📋 リポジトリ毎のマッチ詳細:`);

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
            `  📁 ${repository}: ${matchCount} マッチ (${fileCount} ファイル)`
          );

          // ファイル数が多い場合は上位5つのファイルのみ表示
          if (fileCount > 5) {
            const topFiles = results
              .sort((a, b) => b.matches.length - a.matches.length)
              .slice(0, 5);

            topFiles.forEach((result) => {
              console.log(
                `    📄 ${result.path}: ${result.matches.length} マッチ`
              );
            });

            if (fileCount > 5) {
              console.log(`    ... 他${fileCount - 5}ファイル`);
            }
          } else {
            // ファイル数が少ない場合は全て表示
            results
              .sort((a, b) => b.matches.length - a.matches.length)
              .forEach((result) => {
                console.log(
                  `    📄 ${result.path}: ${result.matches.length} マッチ`
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
      organization: args.org,
      query: args.query,
      extensions,
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
    const outputDir = args.output;
    await Deno.mkdir(outputDir, { recursive: true });

    const extension = args.format;
    const outputPath = `${outputDir}/${args.org}-search-results.${extension}`;

    if (args.format === "csv") {
      const csvContent = convertToCSV(summary);
      await Deno.writeTextFile(outputPath, csvContent);
    } else {
      await Deno.writeTextFile(outputPath, JSON.stringify(summary, null, 2));
    }

    // サマリーを表示
    console.log(`\n📊 検索結果サマリー:`);
    console.log(`- 組織: ${args.org}`);
    console.log(`- 検索クエリ: "${args.query}"`);
    console.log(`- 対象拡張子: ${extensions.join(", ")}`);
    console.log(`- 検索したリポジトリ数: ${repositoryGroups.size}`);
    console.log(`- マッチしたリポジトリ数: ${repositoriesWithMatches}`);
    console.log(`- マッチしたファイル数: ${allResults.length}`);
    console.log(`- 総マッチ数: ${totalMatches}`);
    console.log(`- エラー数: ${errors.length}`);
    console.log(`- 出力形式: ${args.format}`);
    console.log(`- 出力ファイル: ${outputPath}`);

    // 検索統計の詳細表示
    if (searchStats.length > 0) {
      console.log(`\n📈 検索統計:`);
      searchStats.forEach((stat) => {
        const status = stat.hitLimit ? "⚠️ 制限あり" : "✅ 完全";
        console.log(
          `  .${stat.extension}: ${stat.retrieved}/${stat.totalFound} 件 ${status}`
        );
      });

      const hasLimits = searchStats.some((stat) => stat.hitLimit);
      if (hasLimits) {
        console.log(
          `\n⚠️  注意: 一部の拡張子でGitHub Search APIの1000件制限に達しました`
        );
        console.log(
          `   より多くの結果を取得するには、検索クエリをより具体的にしてください`
        );
      }
    }

    if (errors.length > 0) {
      console.log(`\n⚠️  エラーが発生したリポジトリ:`);
      errors.forEach((error) => {
        console.log(`  - ${error.repository}: ${error.error}`);
      });
    }
  } catch (error) {
    console.error("エラーが発生しました:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
