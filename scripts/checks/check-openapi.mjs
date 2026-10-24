import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prettier from "prettier";

const specUrl =
  process.env.API_SPEC_URL ?? "http://localhost:3000/openapi.json";
const generatedPath = join(
  mkdtempSync(join(tmpdir(), "monikey-openapi-check-")),
  "openapi.d.ts",
);
const trackedPath = "packages/contracts/src/generated/openapi.d.ts";
const cli = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32"
    ? "openapi-typescript.cmd"
    : "openapi-typescript",
);

try {
  execFileSync(cli, [specUrl, "-o", generatedPath], { stdio: "inherit" });
  const generated = await prettier.format(readFileSync(generatedPath, "utf8"), {
    parser: "typescript",
    filepath: generatedPath,
  });
  const tracked = readFileSync(trackedPath, "utf8");
  if (generated !== tracked) {
    console.error(
      `OpenAPI declaration drift detected. Regenerate ${trackedPath} from ${specUrl}.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`OpenAPI declaration matches ${specUrl}.`);
  }
} finally {
  rmSync(generatedPath, { force: true });
  rmSync(join(generatedPath, ".."), { recursive: true, force: true });
}
