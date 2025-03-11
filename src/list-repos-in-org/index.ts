import { filterActivate } from "./filters/filterActivate.ts";
import { getReposForOrg } from "./get-repos-in-org.ts";
import { Octokit } from "npm:@octokit/rest@19.0.4";
import { parseArgs } from "https://deno.land/std@0.220.1/cli/parse_args.ts";

// Setup

const flags = parseArgs(Deno.args, {
  string: ["org"],
});

if (!flags.org) {
  console.error("使用方法: deno task start src/list-repos.ts --org=組織名");
  Deno.exit(1);
}

const auth = Deno.env.get("GH_TOKEN");

const octokit = new Octokit({
  auth,
});

// Run

const repos = await getReposForOrg(octokit, flags.org);

console.log(
  filterActivate(repos).map((repo) => {
    return repo.name;
  })
);
