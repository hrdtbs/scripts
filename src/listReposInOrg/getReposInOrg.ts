import { Octokit } from "npm:@octokit/rest@19.0.4";

export const getReposForOrg = async (octokit: Octokit, orgName: string) => {
  const repos = [];
  let page = 1;
  while (true) {
    const response = await octokit.repos.listForOrg({
      org: orgName,
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
