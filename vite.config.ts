import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

// reflect-metadata is a plain script that augments the global Reflect object.
const reflectPolyfill = readFileSync(new URL("./node_modules/reflect-metadata/Reflect.js", import.meta.url), "utf8");

// tsyringe (pulled in by @simplewebauthn) throws on module evaluation unless
// Reflect metadata already exists. Bundling the polyfill as an import gets
// hoisted behind that chunk, so inline it at the top of the chunk instead.
function reflectPolyfillFirst() {
  return {
    name: "reflect-polyfill-first",
    apply: "build" as const,
    renderChunk(code: string, chunk: { modules: Record<string, unknown> }) {
      const needsPolyfill = Object.keys(chunk.modules).some((id) => id.includes("tsyringe"));
      return needsPolyfill ? { code: `${reflectPolyfill}\n${code}`, map: null } : null;
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const allEnv = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, allEnv);
  // Only the public Turnstile site key is extra; everything else stays VITE_.
  const loadedEnv = loadEnv(mode, process.cwd(), ["VITE_", "TURNSTILE_SITE_KEY"]);
  const define = Object.fromEntries(
    Object.entries(loadedEnv).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return {
    define,
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
      ignoreOutdatedRequests: true,
    },
    plugins: [
      reflectPolyfillFirst(),
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
        server: { entry: "server" },
      }),
      ...(command === "build" ? [nitro({ defaultPreset: "node-server" })] : []),
      react(),
    ],
    server: { host: "0.0.0.0", port: 3000, allowedHosts: true },
  };
});
