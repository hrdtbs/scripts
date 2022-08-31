import { Octokit } from "@octokit/rest";

const auth = process.env.GH_AUTH;
const owner = "hrdtbs";
const repos = ["scripts"];
const title = "auto create issue";
const body = ["## Why", "", "## What", ""].join("\n");

const octokit = new Octokit({
  auth,
});

repos.forEach(async (repo) => {
  const result = await octokit.issues.create({
    owner,
    repo,
    title,
    body,
  });
  console.log(result.data.html_url);
});
