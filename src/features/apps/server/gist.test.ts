import { describe, expect, test } from "bun:test";
import { downloadGistApp } from "./gist";

const manifest = JSON.stringify({
  title: "Shared board",
  state: { schema: { type: "array", items: { type: "string" } }, default: [] },
});

const GIST_ID = "aa5a315d61ae9438b18d";

describe("Gist app installation source", () => {
  test("reads the exact app definition files from a public Gist URL", async () => {
    const requested: string[] = [];
    const fetcher = async (input: string | URL) => {
      requested.push(String(input));
      return Response.json({
        id: GIST_ID,
        files: {
          "app.json": {
            content: manifest,
            raw_url: `https://gist.githubusercontent.com/octocat/${GIST_ID}/raw/app.json`,
            truncated: false,
          },
          "app.tsx": {
            content: "export default function App() { return <main />; }",
            raw_url: `https://gist.githubusercontent.com/octocat/${GIST_ID}/raw/app.tsx`,
            truncated: false,
          },
        },
      });
    };

    await expect(
      downloadGistApp(`https://gist.github.com/octocat/${GIST_ID}#file-app-tsx`, fetcher),
    ).resolves.toEqual({
      gistId: GIST_ID,
      manifest,
      tsx: "export default function App() { return <main />; }",
    });
    expect(requested).toEqual([`https://api.github.com/gists/${GIST_ID}`]);
  });

  test("follows raw URLs for truncated files", async () => {
    const rawUrl = `https://gist.githubusercontent.com/octocat/${GIST_ID}/raw/app.tsx`;
    const fetcher = async (input: string | URL) => {
      if (String(input) === rawUrl) {
        return new Response("export default function App() { return <main>Full</main>; }");
      }
      return Response.json({
        id: GIST_ID,
        files: {
          "app.json": {
            content: '{"title":"Shared board"}',
            raw_url: `https://gist.githubusercontent.com/octocat/${GIST_ID}/raw/app.json`,
          },
          "app.tsx": {
            content: "truncated",
            raw_url: rawUrl,
            truncated: true,
          },
        },
      });
    };

    expect((await downloadGistApp(`https://api.github.com/gists/${GIST_ID}`, fetcher)).tsx).toBe(
      "export default function App() { return <main>Full</main>; }",
    );
  });

  test("rejects non-Gist URLs and incomplete Gists", async () => {
    await expect(downloadGistApp("https://example.com/not-a-gist")).rejects.toThrow(
      "GitHub Gist URL",
    );
    await expect(
      downloadGistApp(`https://gist.github.com/octocat/${GIST_ID}/revisions/deadbeef`),
    ).rejects.toThrow("GitHub Gist URL");

    await expect(
      downloadGistApp(`https://gist.github.com/octocat/${GIST_ID}`, async () =>
        Response.json({
          id: GIST_ID,
          files: {
            "app.json": {
              content: '{"title":"Incomplete"}',
              raw_url: `https://gist.githubusercontent.com/octocat/${GIST_ID}/raw/app.json`,
            },
          },
        }),
      ),
    ).rejects.toThrow('files named exactly "app.json" and "app.tsx"');
  });

  test("rejects raw downloads outside GitHub's Gist host", async () => {
    await expect(
      downloadGistApp(`https://gist.github.com/octocat/${GIST_ID}`, async () =>
        Response.json({
          id: GIST_ID,
          files: {
            "app.json": {
              content: '{"title":"Shared board"}',
              raw_url: `https://gist.githubusercontent.com/octocat/${GIST_ID}/raw/app.json`,
            },
            "app.tsx": {
              raw_url: "https://example.com/app.tsx",
              truncated: true,
            },
          },
        }),
      ),
    ).rejects.toThrow("gist.githubusercontent.com");
  });

  test("stops buffering oversized downloads", async () => {
    const rawUrl = `https://gist.githubusercontent.com/octocat/${GIST_ID}/raw/app.tsx`;
    const fetcher = async (input: string | URL) => {
      if (String(input) === rawUrl) {
        return new Response("x", { headers: { "content-length": "600000" } });
      }
      return Response.json({
        id: GIST_ID,
        files: {
          "app.json": {
            content: '{"title":"Shared board"}',
            raw_url: `https://gist.githubusercontent.com/octocat/${GIST_ID}/raw/app.json`,
          },
          "app.tsx": {
            raw_url: rawUrl,
            truncated: true,
          },
        },
      });
    };

    await expect(
      downloadGistApp(`https://gist.github.com/octocat/${GIST_ID}`, fetcher),
    ).rejects.toThrow("too large");
  });
});
