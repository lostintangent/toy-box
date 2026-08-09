import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";

import tailwindTheme from "tailwindcss/theme.css?raw";
import toyBoxTheme from "@/theme.css?raw";

const TAILWIND_THEME = "tailwind-theme";
const TOY_BOX_THEME = "toy-box-theme";

export async function compileAppStyles(source: { id: string; tsx: string }): Promise<string> {
  const compiler = await compile(
    `
      @reference "${TAILWIND_THEME}";
      @reference "${TOY_BOX_THEME}";
      [data-toybox-app="${source.id}"] { @tailwind utilities; }
    `,
    {
      loadStylesheet: async (id) => {
        const content =
          id === TAILWIND_THEME ? tailwindTheme : id === TOY_BOX_THEME ? toyBoxTheme : undefined;
        if (content === undefined) throw new Error(`Unsupported app stylesheet import "${id}".`);
        return { path: id, base: "", content };
      },
    },
  );
  const candidates = new Scanner({ sources: [] }).scanFiles([
    { content: source.tsx, extension: "tsx" },
  ]);
  return compiler.build(candidates);
}
