import { filterActivate } from "./filters/filterActivate.ts";
import { getReposForOrg } from "./get-repos-in-org.ts";
import { Octokit } from "npm:@octokit/rest@19.0.4";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { join } from "https://deno.land/std@0.220.1/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.1/fs/ensure_dir.ts";
import "https://deno.land/std@0.203.0/dotenv/load.ts";

// Setup
const flags = parseArgs(Deno.args, {
  string: ["org", "output"],
  default: {
    output: ".output",
  },
});

if (!flags.org) {
  console.error(
    "使用方法: deno task start src/list-repos.ts --org=組織名 [--output=出力ディレクトリ]"
  );
  Deno.exit(1);
}

const auth = Deno.env.get("GH_TOKEN");

const octokit = new Octokit({
  auth,
});

if (!auth) {
  console.warn(
    "環境変数 GH_TOKEN が設定されていないため、プライベートリポジトリを取得出来ません。",
    "プライベートリポジトリを取得する場合は、.env にGH_TOKENを設定してください。"
  );
}

// Run
const repos = await getReposForOrg(octokit, flags.org);

// Filter
const activeRepos = filterActivate(repos);

// Generate file
const outputDir = flags.output;
await ensureDir(outputDir);

const outputPath = join(outputDir, `${flags.org}-repos.json`);
const jsonContent = JSON.stringify(
  {
    organization: flags.org,
    timestamp: new Date().toISOString(),
    repositories: activeRepos.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      description: repo.description,
      isPrivate: repo.private,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      language: repo.language,
    })),
  },
  null,
  2
);

await Deno.writeTextFile(outputPath, jsonContent);
console.log(`リポジトリ一覧を ${outputPath} に出力しました`);
