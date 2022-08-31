import { Octokit } from "@octokit/rest";

const owner = "hrdtbs";
const repos = ["scripts"];

const title = "";

const body = ["## Why", "", "## What", ""].join("\n");

const auth = process.env.GH_AUTH;

!(async () => {
  const octokit = new Octokit({
    auth,
  });
  repos.forEach(async (repo) => {
    const a = await octokit.issues.create({
      owner,
      repo,
      title,
      body,
    });
    console.log(a);
  });
})();
