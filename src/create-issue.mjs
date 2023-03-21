import { Octokit } from "@octokit/rest";

const auth = process.env.GH_AUTH;
const owner = "hrdtbs";
const repos = ["scripts"];
const title = "auto create issue";
const body = ["## Why", "", "## What", ""].join("\n");

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
