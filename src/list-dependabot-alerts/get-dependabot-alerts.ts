import { Octokit } from "npm:@octokit/rest@19.0.4";

type AlertResult = {
  status: "success" | "error";
  alerts: any[];
  error?: {
    type: "disabled" | "no_access" | "other";
    message: string;
  };
};

export const getDependabotAlerts = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  state: string
): Promise<AlertResult> => {
  try {
    const alerts = [];
    let page = 1;

    while (true) {
      try {
        const response = await octokit.request(
          "GET /repos/{owner}/{repo}/dependabot/alerts",
          {
            owner,
            repo,
            state,
            per_page: 100,
            page,
            headers: {
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
        );

        alerts.push(...response.data);

        if (response.data.length < 100) {
          break;
        }
        page++;
      } catch (error) {
        if (error.status === 404) {
          console.warn(`⚠️ ${owner}/${repo}: Dependabotアラートが無効です`);
          return {
            status: "error",
            alerts: [],
            error: {
              type: "disabled",
              message: "Dependabotアラートが無効です",
            },
          };
        } else if (error.message?.includes("Dependabot alerts are disabled")) {
          console.warn(`⚠️ ${owner}/${repo}: Dependabotアラートが無効です`);
          return {
            status: "error",
            alerts: [],
            error: {
              type: "disabled",
              message: "Dependabotアラートが無効です",
            },
          };
        } else if (error.status === 403) {
          console.warn(`⚠️ ${owner}/${repo}: アクセス権限がありません`);
          return {
            status: "error",
            alerts: [],
            error: {
              type: "no_access",
              message: "アクセス権限がありません",
            },
          };
        } else {
          console.error(
            `❌ ${owner}/${repo}: エラーが発生しました:`,
            error.message
          );
          return {
            status: "error",
            alerts: [],
            error: {
              type: "other",
              message: error.message,
            },
          };
        }
      }
    }

    if (alerts.length > 0) {
      console.log(
        `✅ ${owner}/${repo}: ${alerts.length}件のアラートを取得しました`
      );
    } else {
      console.log(`✅ ${owner}/${repo}: アラートはありません`);
    }

    return {
      status: "success",
      alerts,
    };
  } catch (error) {
    console.error(`❌ ${owner}/${repo}: 予期せぬエラーが発生しました:`, error);
    return {
      status: "error",
      alerts: [],
      error: {
        type: "other",
        message: error.message || "予期せぬエラーが発生しました",
      },
    };
  }
};
