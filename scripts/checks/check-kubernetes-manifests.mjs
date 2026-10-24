import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);
const kubernetesRoot = join(repositoryRoot, "deploy", "kubernetes");

function run(binary, args, label) {
  const result = spawnSync(binary, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (${result.status}):\n${result.stdout.trim()}\n${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function countResources(manifest) {
  return manifest
    .split(/^---\s*$/m)
    .filter((document) => /^\s*(?:apiVersion|kind):/m.test(document)).length;
}

export async function validateKubernetesManifests({
  kustomizeBinary = process.env.KUSTOMIZE_BIN ?? "kustomize",
  kubeconformBinary = process.env.KUBECONFORM_BIN ?? "kubeconform",
  extraSchemaLocation = process.env.KUBECONFORM_EXTRA_SCHEMA_LOCATION,
} = {}) {
  if (!extraSchemaLocation) {
    throw new Error(
      "KUBECONFORM_EXTRA_SCHEMA_LOCATION must point to the cached cert-manager CRD schemas",
    );
  }

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "monikey-v2-kubernetes-check-"),
  );
  try {
    const rootManifest = run(
      kustomizeBinary,
      ["build", kubernetesRoot],
      "Kustomize root build",
    );
    const rootPath = join(temporaryRoot, "root.yaml");
    await writeFile(rootPath, rootManifest, "utf8");

    const rootCount = countResources(rootManifest);
    if (rootCount === 0) {
      throw new Error("Kustomize root rendered no Kubernetes resources");
    }

    const cutoverPath = join(kubernetesRoot, "cutover", "ingress.yaml");
    const cutoverManifest = await readFile(cutoverPath, "utf8");
    const cutoverCount = countResources(cutoverManifest);
    if (cutoverCount !== 1) {
      throw new Error(
        `cutover Ingress file must contain exactly one resource; found ${cutoverCount}`,
      );
    }

    const args = [
      "-strict",
      "-summary",
      "-kubernetes-version",
      "1.30.0",
      "-schema-location",
      "default",
      "-schema-location",
      `${extraSchemaLocation}/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json`,
      rootPath,
      cutoverPath,
    ];
    const validation = run(kubeconformBinary, args, "Kubernetes schema check");
    return { rootCount, cutoverCount, validation };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const result = await validateKubernetesManifests();
  console.log(
    `Kustomize rendered ${result.rootCount} root resources; the separate cutover Ingress also passed strict Kubernetes 1.30 schema validation.`,
  );
  process.stdout.write(result.validation);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
