import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("speichert den Nullpunkt der aktiven Version dauerhaft, einschließlich Zurücksetzen", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gcode-project-test-"));
  const previousDirectory = process.cwd();
  const serverOnlyStub = path.join(directory, "server-only.cjs");
  await writeFile(serverOnlyStub, "");
  // Next.js ersetzt diesen Marker im Server-Build; im Node-Test genügt ein leeres Modul.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: pathToFileURL(serverOnlyStub).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  try {
    process.chdir(directory);
    const { createProject, createProjectVersion, saveProject, loadProject, switchProjectVersion } = await import("../src/lib/project-storage");
    const originalTransform = { rotationDegrees: 0, origin: null };
    await createProject("Test", {
      files: { gcode: { name: "original.gcode", content: "G90\nG0 X0 Y0\n" } },
      dxfTransform: originalTransform,
    });
    await createProjectVersion("test", { name: "edited.gcode", content: "G90\nG0 X1 Y1\n" }, originalTransform);

    const updatedTransform = { rotationDegrees: 90, origin: { x: -2.365, y: 4.5 } };
    await saveProject("test", { dxfTransform: updatedTransform });
    const manifest = JSON.parse(await readFile(path.join(directory, "projects/test/project.json"), "utf8"));
    assert.deepEqual(manifest.dxfTransform, updatedTransform);
    assert.deepEqual(manifest.versions[1].dxfTransform, updatedTransform);
    assert.deepEqual(manifest.versions[0].dxfTransform, originalTransform);
    assert.deepEqual((await loadProject("test")).manifest.dxfTransform, updatedTransform);

    await switchProjectVersion("test", "v1");
    assert.deepEqual((await switchProjectVersion("test", "v2")).manifest.dxfTransform, updatedTransform);
    await saveProject("test", { dxfTransform: originalTransform });
    await switchProjectVersion("test", "v1");
    assert.deepEqual((await switchProjectVersion("test", "v2")).manifest.dxfTransform, originalTransform);
  } finally {
    process.chdir(previousDirectory);
    hooks.deregister();
    await rm(directory, { recursive: true, force: true });
  }
});
