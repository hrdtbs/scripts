import { Select } from "cliffy/prompt/select.ts";
import { Input } from "cliffy/prompt/input.ts";
import { Confirm } from "cliffy/prompt/confirm.ts";
import { expandGlob } from "https://deno.land/std@0.224.0/fs/expand_glob.ts";
import { dirname, relative } from "https://deno.land/std@0.224.0/path/mod.ts";
import { load, stringify } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

async function ensureGhToken(): Promise<string> {
  const env = await load({ envPath: ".env", examplePath: null });
  let token = env.GH_TOKEN;

  if (!token) {
    token = await Input.prompt({
      message: "GH_TOKEN を入力してください:",
      validate: (value) => value.length > 0,
    });
    const envContent = await Deno.readTextFile(".env").catch(() => "");
    await Deno.writeTextFile(".env", envContent + `\nGH_TOKEN=${token}\n`);
    console.log("✅ GH_TOKEN を .env ファイルに保存しました。");
  }

  return token;
}

async function getScripts() {
  const scripts = [];
  const files = expandGlob("src/**/*.{ts,tsx}");
  for await (const file of files) {
    if (file.isFile) {
      scripts.push({
        name: file.name,
        value: file.path,
      });
    }
  }
  return scripts;
}

async function main() {
  const isDryRun = await Confirm.prompt("Dry-runモードで実行しますか？");

  if (!isDryRun) {
    const token = await ensureGhToken();
    Deno.env.set("GH_TOKEN", token);
  }

  const scripts = await getScripts();
  const selectedScriptPath = await Select.prompt({
    message: "実行するスクリプトを選択してください:",
    options: scripts,
    search: true,
  });

  const scriptUrl = new URL(`../${selectedScriptPath}`, import.meta.url).href;
  const scriptModule = await import(scriptUrl);

  const args: string[] = [];
  if (scriptModule.argh) {
    for (const [key, config] of Object.entries(scriptModule.argh)) {
      if (typeof config.prompt === "function") {
        const value = await config.prompt(Input);
        args.push(`--${key}=${value}`);
      }
    }
  }

  if (isDryRun) {
    args.push("--dry-run");
  }

  const command = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      selectedScriptPath,
      ...args,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  const status = await command.spawn().status;
  if (!status.success) {
    console.error(`\n❌ スクリプトの実行に失敗しました: ${selectedScriptPath}`);
  }
}

if (import.meta.main) {
  await main();
}
