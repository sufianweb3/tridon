import fs from "node:fs";
import path from "node:path";

export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

export const repoRoot = findRepoRoot();
export const dataDir = process.env.AGENTSPEND_DATA_DIR ?? path.join(repoRoot, "data");
export const dbPath = process.env.AGENTSPEND_DB ?? path.join(dataDir, "agentspend.db");
export const contractDir = path.join(repoRoot, "contracts");
export const wasmPaths = {
  vault: path.join(contractDir, "target", "wasm32-unknown-unknown", "release", "agentspend_vault.wasm"),
  token: path.join(contractDir, "target", "wasm32-unknown-unknown", "release", "agentspend_test_token.wasm"),
};
