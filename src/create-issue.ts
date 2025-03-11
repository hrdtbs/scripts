import { Octokit } from "npm:@octokit/rest@19.0.4";

const auth = Deno.env.get("GH_TOKEN");

if (!auth) {
  console.error("環境変数 GH_TOKEN が設定されていません");
  Deno.exit(1);
}

// 設定
const owner = "";
const repos: string[] = [];
const title = "";
const body = [].join("\n");

if (!owner) {
  console.error("owner を設定してください");
  Deno.exit(1);
}

if (repos.length === 0) {
  console.error("repos を設定してください");
  Deno.exit(1);
}

if (!title) {
  console.error("title を設定してください");
  Deno.exit(1);
}

const octokit = new Octokit({
  auth,
});

const data = await Promise.all(
  repos.map(async (repo) => {
    const result = await octokit.issues.create({
      owner,
      repo,
      title,
      body,
    });
    return result.data.html_url;
  })
);

console.log(
  data
    .map((url) => {
      return `- [ ] ${url}`;
    })
    .join("\n")
);
