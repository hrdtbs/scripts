#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import { Select } from "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/select.ts";
import { executeCreateIssuesBulk } from "../src/create-issues-bulk/index.ts";
import { executeAddLabels } from "../src/add-labels/index.ts";
import { ensureEnvToken } from "../utils/env.ts";

const menuOptions = [
  {
    name: "Bulk Issue Creation",
    value: "create-issues-bulk",
    execute: executeCreateIssuesBulk,
  },
  {
    name: "Add Labels to Repositories",
    value: "add-labels",
    execute: executeAddLabels,
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
