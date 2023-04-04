import { Octokit } from "@octokit/rest";

const auth = process.env.GH_TOKEN;
const owner = "";
const repos = [];
const title = "";
const body = [].join("\n");

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
