const githubUrlPattern = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^/#?]+))?\/?$/i;

export type GitHubSnapshot = {
  source: string;
  content: string;
  commitSha?: string;
};

export function parseGitHubUrl(source: string) {
  const match = source.match(githubUrlPattern);
  if (!match || !match[1] || !match[2]) return null;
  return { owner: match[1], repository: match[2].replace(/\.git$/i, ""), ref: match[3] };
}

export async function resolveGitHubSnapshot(source: string): Promise<GitHubSnapshot> {
  const parsed = parseGitHubUrl(source);
  if (!parsed) return { source, content: "GitHub URL 형식을 해석할 수 없습니다." };

  const endpoint = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/commits/${encodeURIComponent(parsed.ref ?? "HEAD")}`;
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "study-bot" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { source, content: `GitHub 저장소에 접근할 수 없습니다. HTTP ${response.status}` };
    }
    const payload = (await response.json()) as { sha?: unknown; commit?: { message?: unknown } };
    if (typeof payload.sha !== "string") return { source, content: "Commit SHA를 확인할 수 없습니다." };
    const message = typeof payload.commit?.message === "string" ? payload.commit.message.split("\n", 1)[0] : "";
    return {
      source,
      commitSha: payload.sha,
      content: JSON.stringify({ owner: parsed.owner, repository: parsed.repository, ref: parsed.ref ?? "HEAD", commitMessage: message }),
    };
  } catch (error) {
    return {
      source,
      content: `GitHub 분석에 실패했습니다: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
