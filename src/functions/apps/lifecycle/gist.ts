// Bounded transport for one supported app installation source.

import { z } from "zod";

const gistFileSchema = z.object({
  content: z.string().optional(),
  raw_url: z.string().url(),
  truncated: z.boolean().optional(),
});

const gistSchema = z.object({
  id: z.string().min(1),
  files: z.record(z.string(), gistFileSchema),
});

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const GIST_DOWNLOAD_MAX_BYTES = 512 * 1024;
const GIST_DOWNLOAD_TIMEOUT_MS = 10_000;

export async function downloadGistApp(url: string, fetcher: Fetcher = fetch) {
  const gistId = gistIdFromUrl(url);
  const response = await fetchWithLimits(
    fetcher,
    `https://api.github.com/gists/${encodeURIComponent(gistId)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Toy-Box",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Unable to download Gist (${response.status} ${response.statusText}).`);
  }

  const gist = gistSchema.parse(JSON.parse(await readBoundedText(response)));
  const manifestFile = gist.files["app.json"];
  const componentFile = gist.files["app.tsx"];
  if (!manifestFile || !componentFile) {
    throw new Error('The Gist must contain files named exactly "app.json" and "app.tsx".');
  }

  const [manifest, tsx] = await Promise.all([
    downloadGistFile(manifestFile, fetcher),
    downloadGistFile(componentFile, fetcher),
  ]);
  return { gistId: gist.id, manifest, tsx };
}

function gistIdFromUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("App source must be a valid GitHub Gist URL.");
  }
  if (url.protocol !== "https:") throw new Error("App source must use HTTPS.");

  const path = url.pathname.split("/").filter(Boolean);
  const gistId =
    url.hostname === "gist.github.com" && (path.length === 1 || path.length === 2)
      ? path.at(-1)
      : url.hostname === "api.github.com" && path[0] === "gists" && path.length === 2
        ? path[1]
        : undefined;
  if (!gistId || !/^[a-f0-9]{5,128}$/i.test(gistId)) {
    throw new Error("App source must be a GitHub Gist URL.");
  }
  return gistId;
}

async function downloadGistFile(
  file: z.output<typeof gistFileSchema>,
  fetcher: Fetcher,
): Promise<string> {
  if (!file.truncated && file.content !== undefined) return file.content;

  const rawUrl = rawGistUrl(file.raw_url);
  const response = await fetchWithLimits(fetcher, rawUrl);
  if (!response.ok) {
    throw new Error(`Unable to download a Gist file (${response.status} ${response.statusText}).`);
  }
  if (response.url) rawGistUrl(response.url);
  return readBoundedText(response);
}

function rawGistUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "gist.githubusercontent.com") {
    throw new Error("Gist file downloads must use gist.githubusercontent.com over HTTPS.");
  }
  return url;
}

function fetchWithLimits(
  fetcher: Fetcher,
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetcher(input, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(GIST_DOWNLOAD_TIMEOUT_MS),
  });
}

async function readBoundedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > GIST_DOWNLOAD_MAX_BYTES) {
    throw new Error("Gist download is too large.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > GIST_DOWNLOAD_MAX_BYTES) {
      await reader.cancel();
      throw new Error("Gist download is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
