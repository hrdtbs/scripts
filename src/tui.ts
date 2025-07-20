import { Select } from "cliffy/prompt/select.ts";
import { Input } from "cliffy/prompt/input.ts";
import { Secret } from "cliffy/prompt/secret.ts";
import { load } from "std/dotenv/mod.ts";

async function main() {
  // .envファイルを読み込む
  const env = await load();
  let ghToken = env["GH_TOKEN"] || Deno.env.get("GH_TOKEN");

  if (!ghToken) {
    ghToken = await Secret.prompt("Enter your GH_TOKEN:");
  }

  const scripts = [];
  for await (const dirEntry of Deno.readDir("./src")) {
    if (dirEntry.isFile && dirEntry.name.endsWith(".ts") && dirEntry.name !== "tui.ts") {
      scripts.push(dirEntry.name);
    } else if (dirEntry.isDirectory) {
      // ディレクトリ内の index.ts を探す
      for await (const subDirEntry of Deno.readDir(`./src/${dirEntry.name}`)) {
        if (subDirEntry.isFile && subDirEntry.name === "index.ts") {
          scripts.push(`${dirEntry.name}/index.ts`);
        }
      }
    }
  }

  const selectedScript = await Select.prompt({
    message: "実行したいスクリプトを選択してください:",
    options: scripts,
  });

  if (selectedScript === "create-issue.ts") {
    const { owner, repos, title, body } = await promptForCreateIssue();

    const command = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-env",
        "--allow-net",
        `./src/${selectedScript}`,
        `--owner=${owner}`,
        `--repos=${repos.join(",")}`,
        `--title=${title}`,
        `--body=${body}`,
      ],
      env: {
        GH_TOKEN: ghToken,
      },
    });

    const { code, stdout, stderr } = await command.output();

    if (code === 0) {
      console.log(new TextDecoder().decode(stdout));
    } else {
      console.error(new TextDecoder().decode(stderr));
    }

  } else {
    console.log(`選択されたスクリプト: ${selectedScript} はまだ実装されていません`);
  }
}

async function promptForCreateIssue() {
  const owner = await Input.prompt("Owner:");
  const reposStr = await Input.prompt("Repositories (comma separated):");
  const title = await Input.prompt("Title:");
  const body = await Input.prompt("Body:");
  const repos = reposStr.split(",").map((r) => r.trim());
  return { owner, repos, title, body };
}

if (import.meta.main) {
  main();
}
