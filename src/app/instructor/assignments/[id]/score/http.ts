/**
 * Tiny JSON fetch helpers for the SCORE/baseline client components. Collapse the
 * fetch → res.json().catch → !res.ok → throw-server-message boilerplate that was
 * copy-pasted across ~30 call sites into one throw-on-error call:
 *
 *   const data = await postJSON<{ revisedPrompt: string }>(`${base}/revise`, body);
 *
 * On a non-2xx the thrown Error carries the server's `message`/`error` field, so
 * callers just `catch (e) { setError((e as Error).message) }`.
 */

function serverMessage(data: unknown, status: number): string {
  const d = data as { message?: unknown; error?: unknown } | null;
  if (d && typeof d.message === 'string') return d.message;
  if (d && typeof d.error === 'string') return d.error;
  return `Request failed (${status})`;
}

export async function postJSON<T = unknown>(
  url: string,
  body: unknown,
  opts?: { signal?: AbortSignal; method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' }
): Promise<T> {
  const res = await fetch(url, {
    method: opts?.method ?? 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(serverMessage(data, res.status));
  return data as T;
}

export async function getJSON<T = unknown>(url: string, opts?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, { signal: opts?.signal });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(serverMessage(data, res.status));
  return data as T;
}
