import { cp, copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(repository, "web/dist/pwa");
const inventory = JSON.parse(await readFile(path.join(repository, "third-party-licenses/manifest.json"), "utf8"));
for (const component of inventory.components) {
  if (component.component_root === "web" && !component.lock_dev && component.gap)
    throw new Error(`Missing release notice: ${component.package}@${component.version}`);
}
await mkdir(output, { recursive: true });
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  await copyFile(path.join(repository, name), path.join(output, name));
await cp(path.join(repository, "third-party-licenses"), path.join(output, "third-party-licenses"), { recursive: true });
console.log("Copied original-work terms, dependency inventory, font licenses and full third-party notices into PWA distribution.");
