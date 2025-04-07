import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";
import { Octokit } from "https://esm.sh/@octokit/rest@20.0.2";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";

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

// .envファイルの読み込み
const env = await load();
const token = env.GH_TOKEN;

// コマンドライン引数の解析
const flags = parseArgs(Deno.args, {
  string: ["org", "labels", "colors"],
  default: {
    labels: "",
    colors: "",
  },
});

const org: string = flags.org || "";
const labelNames = flags.labels.split(",").map((label) => label.trim());
const labelColors = flags.colors.split(",").map((color) => color.trim());

if (!token || !org || labelNames.length === 0) {
  console.error(
    "使用方法: deno task start src/add-labels/index.ts --org=ORGANIZATION --labels=LABEL1,LABEL2,... [--colors=COLOR1,COLOR2,...]"
  );
  console.error("\n注意: .envファイルにGH_TOKENを設定してください");
  Deno.exit(1);
}

// ラベルと色のペアを作成
const labels: Label[] = labelNames.map((name, index) => ({
  name,
  color: labelColors[index] || "000000", // 色が指定されていない場合はデフォルトの黒色を使用
}));

// Octokitの初期化
const octokit = new Octokit({
  auth: token,
});

// リポジトリ一覧の取得
async function getRepositories(): Promise<Repository[]> {
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
async function addLabels(repoName: string, labels: Label[]) {
  for (const label of labels) {
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
  try {
    const repositories = await getRepositories();
    const activeRepositories = repositories.filter((repo) => !repo.archived);

    console.log(
      `\n📦 ${org} のアーカイブされていないリポジトリにラベルを追加します`
    );
    console.log(`📌 追加するラベル:`);
    labels.forEach((label) => {
      console.log(`  - ${label.name} (色: ${label.color})`);
    });
    console.log(`\n対象リポジトリ数: ${activeRepositories.length}\n`);

    for (const repo of activeRepositories) {
      console.log(`\n🔄 ${repo.name} の処理を開始します`);
      await addLabels(repo.name, labels);
    }

    console.log("\n✨ 処理が完了しました");
  } catch (error) {
    console.error("❌ エラーが発生しました:", error);
    Deno.exit(1);
  }
}

main();
