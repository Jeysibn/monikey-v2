import { execFileSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is required. Start the local test Compose stack and set the host database URL first.",
  );
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const suites = [
  "test:ledger",
  "test:accounts",
  "test:categories",
  "test:transactions",
  "test:cards",
  "test:bills",
  "test:reports",
  "test:idempotency",
  "test:transfer-crash",
];

for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  execFileSync(npm, ["run", suite, "--workspace", "@monikey/api"], {
    stdio: "inherit",
    env: process.env,
  });
}

console.log("\nAll PostgreSQL integration suites passed.");
