// Vite expands `import.meta.glob` at build time, but Bun can't yet
// (oven-sh/bun#6060). This plugin expands the default-import globs that
// composition modules use to discover feature modules, wherever Bun loads
// source outside Vite: `bun test` preloads it, and so does the dev socket
// listener. It produces Vite's objects: each match keyed by its path, eagerly
// or lazily.

import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const globCall = /import\.meta\.glob(?:<[\s\S]*?>)?\(\s*"(.+?)",\s*(\{[^}]*\}),?\s*\)/g;

plugin({
  name: "import.meta.glob",
  setup(build) {
    build.onLoad({ filter: /\/src\/.+\.ts$/ }, ({ path }) => {
      // Like Vite, eager matches become static imports, so they join the module graph.
      const imports: string[] = [];
      const contents = readFileSync(path, "utf8").replace(
        globCall,
        (call: string, pattern: string, options: string) => {
          // Leave any other form untouched, so it fails loudly instead of loading wrongly.
          if (!/import:\s*"default"/.test(options) || /query:/.test(options)) return call;
          const eager = /eager:\s*true/.test(options);
          const [, prefix, rest] = pattern.match(/^((?:\.\.\/)*)(.*)$/)!;
          const base = resolve(dirname(path), prefix);
          const modules = [...new Bun.Glob(rest).scanSync(base)].map((match) => {
            const module = JSON.stringify(resolve(base, match));
            const name = `__glob${imports.length}`;
            if (eager) imports.push(`import ${name} from ${module};`);
            const value = eager ? name : `() => import(${module}).then((module) => module.default)`;
            return `${JSON.stringify(prefix + match)}: ${value}`;
          });
          return `{ ${modules.join(", ")} }`;
        },
      );
      return { loader: "ts", contents: imports.join("\n") + "\n" + contents };
    });
  },
});
