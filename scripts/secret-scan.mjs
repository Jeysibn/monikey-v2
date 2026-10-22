import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const rules = [
  {
    name: "private key material",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  },
  {
    name: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    name: "credentialed database URL",
    pattern:
      /(?:postgres(?:ql)?|mysql):\/\/(?!\$\{)[^:\s]+:(?!local-only-change-me|test(?:@|\b)|test-only|CI-only|\$\{)[^@\s]+@/i,
  },
];

const findings = [];
for (const file of trackedFiles) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;
  for (const rule of rules) {
    if (rule.pattern.test(source)) findings.push(`${file}: ${rule.name}`);
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found in tracked text files:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(
  `Secret scan passed: ${trackedFiles.length} tracked files checked.`,
);
