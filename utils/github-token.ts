/**
 * GitHub認証トークンを取得する。
 * `gh auth token` で gh CLI の認証トークンを取得する。
 * @throws gh CLI が未認証またはインストールされていない場合
 */
export async function getGitHubToken(): Promise<string> {
  try {
    const command = new Deno.Command("gh", {
      args: ["auth", "token"],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout } = await command.output();
    if (code === 0) {
      const token = new TextDecoder().decode(stdout).trim();
      if (token) return token;
    }
  } catch {
    // gh がインストールされていない
  }

  throw new Error(
    "GitHub token not found. Please install gh CLI and run `gh auth login`."
  );
}
