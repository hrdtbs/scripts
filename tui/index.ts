#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

import {
  Select,
  type SelectOption,
} from "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/select.ts";
import { executeCreateIssuesBulk } from "../src/create-issues-bulk/index.ts";

const menuOptions: SelectOption<string>[] = [
  {
    name: "Hello",
    value: "hello",
  },
  {
    name: "Bulk Issue Creation",
    value: "create-issues-bulk",
  },
  {
    name: "Help",
    value: "help",
  },
  {
    name: "Exit",
    value: "exit",
  },
];

async function executeHello(): Promise<void> {
  console.log("Hello!");
  await Deno.stdin.read(new Uint8Array(1));
}

async function executeHelp(): Promise<void> {
  console.log("📚 Help");
  console.log("=======");
  console.log("Hello: Display greeting message");
  console.log("Bulk Issue Creation: Create issues in multiple repositories");
  console.log("Help: Show this help message");
  console.log("Exit: Exit the program");
  await Deno.stdin.read(new Uint8Array(1));
}

async function main(): Promise<void> {
  const choice = await Select.prompt({
    message: "Please select:",
    options: menuOptions,
  });

  switch (choice) {
    case "hello":
      await executeHello();
      break;
    case "create-issues-bulk":
      await executeCreateIssuesBulk();
      break;
    case "help":
      await executeHelp();
      break;
    case "exit":
      Deno.exit(0);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
