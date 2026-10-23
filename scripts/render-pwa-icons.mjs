import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDirectory = join(repositoryRoot, "apps", "web", "public");
const sourcePath = join(publicDirectory, "icon.svg");

export async function renderPwaIcons() {
  const source = await readFile(sourcePath, "utf8");
  if (!/<svg\b/.test(source) || !/viewBox="0 0 512 512"/.test(source)) {
    throw new Error("PWA icon source must be an SVG with a 512 square viewBox");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await mkdir(publicDirectory, { recursive: true });
    for (const size of [180, 192, 512]) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });
      await page.setContent(`
        <style>html,body{width:${size}px;height:${size}px;margin:0;overflow:hidden}svg{display:block;width:100%;height:100%}</style>
        ${source}
      `);
      const image = await page.screenshot({ type: "png" });
      if (
        image.subarray(1, 4).toString("ascii") !== "PNG" ||
        image.readUInt32BE(16) !== size ||
        image.readUInt32BE(20) !== size
      ) {
        throw new Error(`generated PWA icon is not ${size}x${size} PNG`);
      }
      await writeFile(join(publicDirectory, `icon-${size}.png`), image);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  renderPwaIcons()
    .then(() => console.log("Rendered 180px, 192px, and 512px PWA icons."))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
