export interface XPageFetchOptions {
  firstResponse: Response;
  baseUrl: string;
  params: URLSearchParams;
  bearer: string;
  budgetMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchAllXSearchPages(
  options: XPageFetchOptions,
): Promise<any[]> {
  const pages: any[] = [];
  let response = options.firstResponse;
  const deadline = Date.now() + (options.budgetMs ?? 70_000);
  const timeoutMs = options.requestTimeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const seenTokens = new Set<string>();
  while (true) {
    const body = await response.json();
    pages.push(body);
    const token = String(body?.meta?.next_token ?? "").trim();
    if (!token) return pages;
    if (seenTokens.has(token)) throw new Error("x_pagination_token_cycle");
    seenTokens.add(token);
    if (Date.now() >= deadline) {
      throw new Error("x_pagination_budget_exhausted");
    }
    const params = new URLSearchParams(options.params);
    params.set("next_token", token);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(`${options.baseUrl}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${options.bearer}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`x_api_pagination_error_${response.status}`);
    }
  }
}

export function oldestFirstXPages<T>(pages: T[]): T[] {
  return [...pages].reverse();
}
