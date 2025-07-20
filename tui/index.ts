#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import {
  Select,
  type SelectOption,
} from "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/select.ts";
import { executeCreateIssuesBulk } from "../src/create-issues-bulk/index.ts";
import { ensureEnvToken } from "../utils/env.ts";

const menuOptions: SelectOption<string>[] = [
  {
    name: "Bulk Issue Creation",
    value: "create-issues-bulk",
  },
  {
    name: "Exit",
    value: "exit",
  },
];

async function main(): Promise<void> {
  await ensureEnvToken();

  const choice = await Select.prompt({
    message: "Please select:",
    options: menuOptions,
  });

  switch (choice) {
    case "create-issues-bulk":
      await executeCreateIssuesBulk();
      break;
    case "exit":
      Deno.exit(0);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
