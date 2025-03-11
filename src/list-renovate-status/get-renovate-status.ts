import { Octokit } from "npm:@octokit/rest@19.0.4";

type DependencyGroup = {
  title: string;
  count: number;
  dependencies: string[];
};

export type RenovateStatus = {
  status: "enabled" | "disabled";
  dependencyCount?: number;
  dashboardIssueUrl?: string;
  dependencyGroups?: DependencyGroup[];
};

function extractDependencyGroups(body: string): DependencyGroup[] {
  const groups: DependencyGroup[] = [];
  let currentGroup: DependencyGroup | null = null;

  // 行ごとに処理
  const lines = body.split("\n");
  for (const line of lines) {
    // 見出しの検出
    if (line.startsWith("##")) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        title: line.replace(/^##\s+/, "").trim(),
        count: 0,
        dependencies: [],
      };
    }
    // チェックボックスの検出
    else if (currentGroup && line.trim().startsWith("- [ ]")) {
      // 手動実行用のチェックボックスを除外
      if (line.includes("<!-- manual job -->")) {
        continue;
      }

      currentGroup.count++;
      // 依存関係の名前を抽出
      const match = line.match(
        /fix\(deps\): update (?:dependency|module) ([^\s]+)|chore\(deps\): update ([^\s]+)/
      );
      if (match) {
        const dependency = match[1] || match[2];
        currentGroup.dependencies.push(dependency);
      }
    }
  }

  // 最後のグループを追加
  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

export async function getRenovateStatus(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RenovateStatus> {
  try {
    // Dependency Dashboardを検索
    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      creator: "renovate[bot]",
      state: "open",
    });

    const dashboardIssue = issues.find((issue) =>
      issue.title.includes("Dependency Dashboard")
    );

    if (!dashboardIssue) {
      return {
        status: "disabled",
      };
    }

    // チェックボックスの数をカウント（手動実行用のチェックボックスを除外）
    const checkboxCount = (dashboardIssue.body?.match(/- \[[ x]\]/g) || [])
      .length;
    const manualJobCount = (
      dashboardIssue.body?.match(/<!-- manual job -->/g) || []
    ).length;

    // 依存関係のグループを抽出
    const dependencyGroups = dashboardIssue.body
      ? extractDependencyGroups(dashboardIssue.body)
      : [];

    return {
      status: "enabled",
      dependencyCount: Math.max(0, checkboxCount - manualJobCount), // 手動実行用のチェックボックスを除外
      dashboardIssueUrl: dashboardIssue.html_url,
      dependencyGroups,
    };
  } catch (error) {
    console.error(
      `Error checking Renovate status for ${owner}/${repo}:`,
      error
    );
    return {
      status: "disabled",
    };
  }
}
