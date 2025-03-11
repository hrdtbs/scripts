import { Octokit } from "npm:@octokit/rest@19.0.4";

const auth = Deno.env.get("GH_TOKEN");

const orgName = "";

const octokit = new Octokit({
  auth,
});

const getReposForOrg = async (octokit: Octokit, orgName: string) => {
  const repos = [];
  let page = 1;
  while (true) {
    const response = await octokit.repos.listForOrg({
      org: orgName,
      type: "private",
      per_page: 30,
      page,
    });
    repos.push(...response.data);
    if (response.data.length < 30) {
      break;
    }
    page++;
  }
  return repos;
};

const repos = await getReposForOrg(octokit, orgName);

const activeRepos = repos.filter((repo) => {
  return !repo.archived;
});

const targetRepos = activeRepos.filter((repo) => {
  return repo.name.includes("front");
});

console.log(
  targetRepos.map((repo) => {
    return repo.name;
  })
);
