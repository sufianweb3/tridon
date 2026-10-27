/**
 * Delete the local SQLite database so `pnpm seed` can provision a fresh demo
 * workspace. Destructive and opt-in: requires `--yes`.
 *
 * The master key is intentionally left in place. Removing it would make any
 * remaining encrypted signer material unreadable, and it is not part of the
 * database.
 */
import fs from "node:fs";
import { dbPath } from "../apps/web/src/lib/paths";

const confirmed = process.argv.includes("--yes");
if (!confirmed) {
  console.error("Refusing to delete the demo database without confirmation.");
  console.error("");
  console.error(`  database: ${dbPath}`);
  console.error("");
  console.error("This removes all local users, payments, approvals and settings.");
  console.error("Re-run with:  pnpm db:reset -- --yes");
  process.exit(1);
}

const suffixes = ["", "-wal", "-shm", "-journal"];
let removed = 0;
for (const suffix of suffixes) {
  const target = `${dbPath}${suffix}`;
  try {
    fs.rmSync(target, { force: true });
    if (fs.existsSync(target)) throw new Error("file still exists");
    removed += 1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
    console.error(`Could not delete ${target}.`);
    console.error("Stop the dev server first, then retry.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

console.log(`Removed ${removed} database file(s) at ${dbPath}.`);
console.log("Run `pnpm seed` to provision a new demo workspace.");
