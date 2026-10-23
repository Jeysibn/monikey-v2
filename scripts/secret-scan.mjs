import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const historicalPathByObject = new Map();
for (const entry of execFileSync("git", ["rev-list", "--objects", "--all"], {
  encoding: "utf8",
}).split("\n")) {
  const match = /^([0-9a-f]{40,64})\s+(.+)$/.exec(entry);
  if (match && !historicalPathByObject.has(match[1])) {
    historicalPathByObject.set(match[1], match[2]);
  }
}

const historicalObjectIds = [...historicalPathByObject.keys()];
const historicalBlobs = historicalObjectIds.length
  ? execFileSync("git", ["cat-file", "--batch"], {
      input: `${historicalObjectIds.join("\n")}\n`,
      maxBuffer: 256 * 1024 * 1024,
    })
  : Buffer.alloc(0);

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
const reported = new Set();
function scanText(path, source) {
  if (source.includes("\0")) return;
  for (const rule of rules) {
    if (rule.pattern.test(source)) {
      const finding = `${path}: ${rule.name}`;
      if (!reported.has(finding)) {
        reported.add(finding);
        findings.push(finding);
      }
    }
  }
}

for (const file of trackedFiles) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  scanText(file, source);
}

let offset = 0;
for (let index = 0; index < historicalObjectIds.length; index += 1) {
  const headerEnd = historicalBlobs.indexOf(0x0a, offset);
  if (headerEnd < 0) break;
  const header = historicalBlobs.toString("utf8", offset, headerEnd);
  offset = headerEnd + 1;
  const [objectId, objectType, rawSize] = header.split(" ");
  const size = Number(rawSize);
  if (objectType !== "blob" || !Number.isSafeInteger(size) || size < 0) {
    continue;
  }
  const contentEnd = offset + size;
  if (contentEnd > historicalBlobs.length) break;
  if (objectId === historicalObjectIds[index]) {
    scanText(
      historicalPathByObject.get(objectId) ?? "<historical blob>",
      historicalBlobs.toString("utf8", offset, contentEnd),
    );
  }
  offset = contentEnd + 1;
}

if (findings.length > 0) {
  console.error("Potential secrets found in tracked text files:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(
  `Secret scan passed: ${trackedFiles.length} tracked files and ${historicalObjectIds.length} reachable Git objects checked.`,
);
