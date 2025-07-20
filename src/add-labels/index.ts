import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { Octokit } from "https://esm.sh/@octokit/rest@20.0.2";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";
import type { Input } from "cliffy/prompt/mod.ts";

export const argh = {
  org: {
    type: "string",
    prompt: (p: typeof Input) => p.prompt("GitHub organization:"),
  },
  labels: {
    type: "string",
    prompt: (p: typeof Input) => p.prompt("Labels (comma-separated):"),
  },
  colors: {
    type: "string",
    prompt: (p: typeof Input) => p.prompt("Colors (comma-separated):"),
  },
};

// 型定義
interface Repository {
  name: string;
  archived: boolean;
}

interface GitHubError {
  status: number;
  message: string;
}

interface GitHubRepoResponse {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  archived?: boolean;
  [key: string]: unknown;
}

interface Label {
  name: string;
  color: string;
}


// リポジトリ一覧の取得
async function getRepositories(octokit: Octokit, org: string): Promise<Repository[]> {
  const repos: Repository[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.repos.listForOrg({
      org,
      type: "all",
      per_page: 100,
      page,
    });

    repos.push(
      ...data.map((repo: GitHubRepoResponse) => ({
        name: repo.name,
        archived: repo.archived || false,
      }))
    );

    if (data.length < 100) {
      break;
    }
    page++;
  }

  return repos;
}

// ラベルの追加
async function addLabels(octokit: Octokit | null, org: string, repoName: string, labels: Label[], isDryRun: boolean) {
  for (const label of labels) {
    console.log(
      `${isDryRun ? "[DRY RUN] " : ""} ${repoName}: ラベル "${label.name}" (色: ${label.color}) を追加します`
    );
    if (isDryRun || !octokit) {
      continue;
    }
    try {
      await octokit.issues.createLabel({
        owner: org,
        repo: repoName,
        name: label.name,
        color: label.color,
      });
      console.log(
        `✅ ${repoName}: ラベル "${label.name}" (色: ${label.color}) を追加しました`
      );
    } catch (error) {
      const githubError = error as GitHubError;
      if (githubError.status === 422) {
        console.log(`ℹ️ ${repoName}: ラベル "${label.name}" は既に存在します`);
      } else {
        console.error(
          `❌ ${repoName}: ラベル "${label.name}" の追加に失敗しました`,
          error
        );
      }
    }
  }
}

// メイン処理
async function main() {
  const env = await load();
  const token = env.GH_TOKEN;

  const flags = parseArgs(Deno.args, {
    string: ["org", "labels", "colors"],
    boolean: ["dry-run"],
    default: {
      labels: "",
      colors: "",
      "dry-run": false,
    },
  });

  const org: string = flags.org || "";
  const labelNames = flags.labels.split(",").map((label) => label.trim());
  const labelColors = flags.colors.split(",").map((color) => color.trim());

  const isDryRun = flags["dry-run"];

  if (!isDryRun && !token) {
    console.error("GH_TOKENが設定されていません。");
    Deno.exit(1);
  }

  if (!org || labelNames.length === 0) {
    console.error(
      "使用方法: deno task start src/add-labels/index.ts --org=ORGANIZATION --labels=LABEL1,LABEL2,... [--colors=COLOR1,COLOR2,...]"
    );
    Deno.exit(1);
  }

  const labels: Label[] = labelNames.map((name, index) => ({
    name,
    color: labelColors[index] || "000000", // 色が指定されていない場合はデフォルトの黒色を使用
  }));

  const octokit = isDryRun ? null : new Octokit({
    auth: token,
  });

  try {
    const repositories = (isDryRun || !octokit) ? [] : await getRepositories(octokit, org);
    const activeRepositories = repositories.filter((repo) => !repo.archived);

    if (isDryRun) {
      console.log("[DRY RUN] 以下のリポジトリにラベルを追加します (API呼び出しは行いません):");
    } else {
      console.log(
        `\n📦 ${org} のアーカイブされていないリポジトリにラベルを追加します`
      );
    }

    console.log(`📌 追加するラベル:`);
    labels.forEach((label) => {
      console.log(`  - ${label.name} (色: ${label.color})`);
    });
    console.log(`\n対象リポジトリ数: ${activeRepositories.length}\n`);

    for (const repo of activeRepositories) {
      console.log(`\n🔄 ${repo.name} の処理を開始します`);
      await addLabels(octokit, org, repo.name, labels, isDryRun);
    }

    console.log("\n✨ 処理が完了しました");
  } catch (error) {
    console.error("❌ エラーが発生しました:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
