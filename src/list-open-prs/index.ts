import { parse } from "https://deno.land/std@0.210.0/flags/mod.ts";
import { Octokit } from "npm:@octokit/rest@20.0.2";
import "https://deno.land/std@0.210.0/dotenv/load.ts";

interface PullRequest {
  repository: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: string;
}

async function listOpenPRs(org: string): Promise<PullRequest[]> {
  const octokit = new Octokit({
    auth: Deno.env.get("GH_TOKEN"),
  });

  const query = `archived:false user:${org} is:pr is:open draft:false sort:created-asc`;
  const prs: PullRequest[] = [];

  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: 100,
    });

    for (const item of data.items) {
      prs.push({
        repository: item.repository_url.split("/").slice(-1)[0],
        number: item.number,
        title: item.title,
        url: item.html_url,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        author: item.user?.login || "unknown",
      });
    }
  } catch (error) {
    console.error("エラーが発生しました:", error);
    throw error;
  }

  return prs;
}

function convertToCSV(prs: PullRequest[]): string {
  const headers = [
    "repository",
    "number",
    "title",
    "url",
    "createdAt",
    "updatedAt",
    "author",
  ];
  const rows = prs.map((pr) => {
    return [
      pr.repository,
      pr.number.toString(),
      `"${pr.title.replace(/"/g, '""')}"`,
      pr.url,
      pr.createdAt,
      pr.updatedAt,
      pr.author,
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

async function main() {
  const args = parse(Deno.args, {
    string: ["org", "output", "format"],
    default: {
      output: ".output",
      format: "json",
    },
  });

  if (!args.org) {
    console.error("エラー: --org オプションは必須です");
    Deno.exit(1);
  }

  if (!["json", "csv"].includes(args.format)) {
    console.error(
      "エラー: --format オプションはjsonまたはcsvを指定してください"
    );
    Deno.exit(1);
  }

  try {
    const prs = await listOpenPRs(args.org);

    const outputDir = args.output;
    await Deno.mkdir(outputDir, { recursive: true });

    const extension = args.format;
    const outputPath = `${outputDir}/${args.org}-open-prs.${extension}`;

    if (args.format === "csv") {
      const csvContent = convertToCSV(prs);
      await Deno.writeTextFile(outputPath, csvContent);
    } else {
      const output = {
        organization: args.org,
        timestamp: new Date().toISOString(),
        pullRequests: prs,
      };
      await Deno.writeTextFile(outputPath, JSON.stringify(output, null, 2));
    }

    console.log(`📊 サマリー:`);
    console.log(`- 組織: ${args.org}`);
    console.log(`- オープンPR数: ${prs.length}`);
    console.log(`- 出力形式: ${args.format}`);
    console.log(`- 出力ファイル: ${outputPath}`);
  } catch (error) {
    console.error("エラーが発生しました:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
