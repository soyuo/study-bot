const githubUrlPattern = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^/#?]+))?\/?$/i;
const supportedExtensions = new Set([".ts", ".js", ".mjs", ".cjs", ".json", ".go", ".py", ".java", ".kt", ".rs", ".md", ".txt", ".yaml", ".yml", ".toml"]);
const maxFiles = 20;
const maxTotalBytes = 200_000;

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

export function isSupportedSourcePath(path: string) {
  if (path.includes("/node_modules/") || path.startsWith("node_modules/") || path.includes("/.git/")) return false;
  if (path.split("/").some((part) => part.startsWith("."))) return false;
  const lower = path.toLowerCase();
  return lower.endsWith("/readme.md") || [...supportedExtensions].some((extension) => lower.endsWith(extension));
}

async function fetchJson(url: string) {
  return fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "study-bot" },
    signal: AbortSignal.timeout(5_000),
  });
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
    const payload = (await response.json()) as {
      sha?: unknown;
      commit?: { message?: unknown; tree?: { sha?: unknown } };
    };
    if (typeof payload.sha !== "string") return { source, content: "Commit SHA를 확인할 수 없습니다." };
    const message = typeof payload.commit?.message === "string" ? payload.commit.message.split("\n", 1)[0] : "";
    const commitSha = payload.sha;
    const treeSha = typeof payload.commit?.tree?.sha === "string" ? payload.commit.tree.sha : commitSha;
    const treeResponse = await fetchJson(
      `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    );
    const files: Array<{ path: string; content: string; truncated: boolean }> = [];
    let treeTruncated = false;
    if (treeResponse.ok) {
      const treePayload = (await treeResponse.json()) as {
        truncated?: boolean;
        tree?: Array<{ path?: unknown; type?: unknown; size?: unknown }>;
      };
      treeTruncated = treePayload.truncated === true;
      const candidates = (treePayload.tree ?? [])
        .filter(
          (entry): entry is { path: string; type: "blob"; size?: unknown } =>
            entry.type === "blob" && typeof entry.path === "string" && isSupportedSourcePath(entry.path),
        )
        .sort((left, right) => {
          const leftReadme = left.path.toLowerCase().includes("readme") ? 0 : 1;
          const rightReadme = right.path.toLowerCase().includes("readme") ? 0 : 1;
          return leftReadme - rightReadme || left.path.localeCompare(right.path);
        })
        .slice(0, maxFiles);
      let totalBytes = 0;
      for (const entry of candidates) {
        if (totalBytes >= maxTotalBytes) break;
        const rawPath = entry.path;
        const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/${commitSha}/${rawPath.split("/").map(encodeURIComponent).join("/")}`;
        const fileResponse = await fetch(rawUrl, { signal: AbortSignal.timeout(5_000) });
        if (!fileResponse.ok) continue;
        const text = await fileResponse.text();
        const remaining = maxTotalBytes - totalBytes;
        const content = text.slice(0, remaining);
        totalBytes += content.length;
        files.push({ path: rawPath, content, truncated: content.length < text.length });
      }
    }
    return {
      source,
      commitSha,
      content: JSON.stringify({
        owner: parsed.owner,
        repository: parsed.repository,
        ref: parsed.ref ?? "HEAD",
        commitMessage: message,
        treeTruncated,
        files,
      }),
    };
  } catch (error) {
    return {
      source,
      content: `GitHub 분석에 실패했습니다: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
