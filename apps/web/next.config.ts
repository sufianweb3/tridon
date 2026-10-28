import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * The Neon CLI writes `.env.local` at the workspace root, but Next.js only
 * loads env files from the app directory. Load the root files here so
 * `next dev`, `next build` and `next start` all see the same credentials.
 * Existing process env always wins; `.env.local` wins over `.env`.
 */
function loadWorkspaceEnv(): void {
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      for (const name of [".env.local", ".env"]) {
        const file = path.join(dir, name);
        if (fs.existsSync(file)) {
          try {
            process.loadEnvFile(file);
          } catch (error) {
            console.warn(
              `[env] could not load ${name}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadWorkspaceEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
