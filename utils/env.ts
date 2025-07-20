import { exists } from "https://deno.land/std@0.220.1/fs/exists.ts";
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";

// .envファイルの設定を確認・作成する関数
export async function ensureEnvToken(): Promise<string> {
  const envPath = ".env";
  const envExists = await exists(envPath);

  let envContent = "";
  let token = "";

  if (envExists) {
    // 既存の.envファイルを読み込み
    envContent = await Deno.readTextFile(envPath);
    try {
      const env = await load();
      token = env.GH_TOKEN || "";
    } catch {
      // GH_TOKENが定義されていない場合は空文字列のまま
      token = "";
    }
  }

  // GH_TOKENが設定されていない場合、ユーザーに入力を要求
  if (!token) {
    const { Input } = await import(
      "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts"
    );

    console.log("GitHub Personal Access Token is required.");
    console.log("You can create one at: https://github.com/settings/tokens");
    console.log(
      "Required permissions: repo (Full control of private repositories)"
    );
    console.log("");

    token = await Input.prompt({
      message: "Enter your GitHub Personal Access Token:",
      validate: (value: string) => {
        if (!value.trim()) {
          return "Token is required";
        }
        if (
          !value.startsWith("ghp_") &&
          !value.startsWith("gho_") &&
          !value.startsWith("ghu_")
        ) {
          return "Token should start with ghp_, gho_, or ghu_";
        }
        return true;
      },
    });

    // .envファイルに追記
    const newEnvContent =
      envContent +
      (envContent.endsWith("\n") ? "" : "\n") +
      `GH_TOKEN=${token}\n`;
    await Deno.writeTextFile(envPath, newEnvContent);

    console.log("Token saved to .env file");
  }

  return token;
}
