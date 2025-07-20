#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import { Select } from "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/select.ts";
import { executeCreateIssuesBulk } from "../src/bulk-create-issues/index.ts";
import { executeBulkAddLabels } from "../src/bulk-add-labels/index.ts";
import { executeListDependabotAlerts } from "../src/list-dependabot-alerts/index.ts";
import { executeListOpenPRs } from "../src/list-open-prs/index.ts";
import { ensureEnvToken } from "../utils/env.ts";

const menuOptions = [
  {
    name: "Bulk Create Issues",
    value: "bulk-create-issues",
    execute: executeCreateIssuesBulk,
  },
  {
    name: "Bulk Add Labels to Repositories",
    value: "bulk-add-labels",
    execute: executeBulkAddLabels,
  },
  {
    name: "List Dependabot Alerts",
    value: "list-dependabot-alerts",
    execute: executeListDependabotAlerts,
  },
  {
    name: "List Open Pull Requests",
    value: "list-open-prs",
    execute: executeListOpenPRs,
  },
  {
    name: "Exit",
    value: "exit",
    execute: () => {
      Deno.exit(0);
    },
  },
];

async function main(): Promise<void> {
  await ensureEnvToken();

  const choice = await Select.prompt<string>({
    message: "Please select:",
    options: menuOptions,
  });

  const execute = menuOptions.find(
    (option) => option.value === choice
  )?.execute;

  if (execute) {
    await execute();
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
