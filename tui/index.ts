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
    name: "Issue一括作成",
    value: "create-issues-bulk",
  },
  {
    name: "Help",
    value: "help",
  },
  {
    name: "終了",
    value: "exit",
  },
];

async function executeHello(): Promise<void> {
  console.log("こんにちは！");
  await Deno.stdin.read(new Uint8Array(1));
}

async function executeHelp(): Promise<void> {
  console.log("📚 ヘルプ");
  console.log("=======");
  console.log("Hello: 挨拶メッセージを表示");
  console.log("Issue一括作成: 複数リポジトリにIssueを一括作成");
  console.log("Help: このヘルプメッセージを表示");
  console.log("終了: プログラムを終了");
  await Deno.stdin.read(new Uint8Array(1));
}

async function main(): Promise<void> {
  while (true) {
    console.clear();

    const choice = await Select.prompt({
      message: "選択してください:",
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
}

if (import.meta.main) {
  main().catch(console.error);
}
