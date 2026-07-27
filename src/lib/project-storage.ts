import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LoadedProject,
  PROJECT_SCHEMA_VERSION,
  ProjectManifest,
  ProjectSummary,
  ProjectUpload,
  SaveProjectRequest,
} from "./project";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const PROJECTS_ROOT = path.join(process.cwd(), "projects");

export function projectSlug(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw new Error("Der Projektname enthält keine verwendbaren Zeichen.");
  return slug;
}

function validatedSlug(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new Error("Ungültiger Projektbezeichner.");
  return slug;
}

function projectDirectory(slug: string) {
  return path.join(PROJECTS_ROOT, validatedSlug(slug));
}

async function atomicJsonWrite(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function validateUpload(upload: ProjectUpload) {
  if (!upload.name.trim()) throw new Error("Eine Eingabedatei hat keinen Namen.");
  if (Buffer.byteLength(upload.content, "utf8") > MAX_FILE_SIZE) throw new Error("Eine Eingabedatei überschreitet 20 MB.");
}

async function persistInput(directory: string, kind: "dxf" | "gcode", upload: ProjectUpload) {
  validateUpload(upload);
  const extension = kind === "dxf" ? ".dxf" : path.extname(upload.name).toLowerCase() || ".gcode";
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : kind === "dxf" ? ".dxf" : ".gcode";
  const relativePath = `inputs/${kind === "dxf" ? "contour" : "toolpath"}${safeExtension}`;
  const targetPath = path.join(directory, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, upload.content, "utf8");
  return {
    path: relativePath,
    originalName: path.basename(upload.name),
    sha256: createHash("sha256").update(upload.content).digest("hex"),
  };
}

function isManifest(value: unknown): value is ProjectManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ProjectManifest>;
  return manifest.schemaVersion === PROJECT_SCHEMA_VERSION && typeof manifest.name === "string" && !!manifest.files && !!manifest.dxfTransform;
}

async function readManifest(slug: string) {
  const content = await readFile(path.join(projectDirectory(slug), "project.json"), "utf8");
  const parsed: unknown = JSON.parse(content);
  if (!isManifest(parsed)) throw new Error("Das Projektmanifest ist ungültig oder hat eine nicht unterstützte Version.");
  return parsed;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(PROJECTS_ROOT, { recursive: true });
  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
  const projects = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {
      const manifest = await readManifest(entry.name);
      return { slug: entry.name, name: manifest.name, updatedAt: manifest.updatedAt, hasDxf: !!manifest.files.dxf, hasGcode: !!manifest.files.gcode };
    } catch {
      return null;
    }
  }));
  return projects.filter((project): project is ProjectSummary => project !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createProject(name: string, request: SaveProjectRequest) {
  const slug = projectSlug(name);
  const directory = projectDirectory(slug);
  let exists = false;
  try {
    await stat(path.join(directory, "project.json"));
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists) throw new Error("Ein Projekt mit diesem Namen existiert bereits.");
  await mkdir(directory, { recursive: true });
  return saveProject(slug, { ...request, name });
}

export async function saveProject(slug: string, request: SaveProjectRequest): Promise<ProjectManifest> {
  const directory = projectDirectory(slug);
  await mkdir(directory, { recursive: true });
  let current: ProjectManifest | null = null;
  try { current = await readManifest(slug); } catch { /* Neues Projekt. */ }

  const files = { dxf: current?.files.dxf ?? null, gcode: current?.files.gcode ?? null };
  if (request.files?.dxf) files.dxf = await persistInput(directory, "dxf", request.files.dxf);
  if (request.files?.gcode) files.gcode = await persistInput(directory, "gcode", request.files.gcode);

  const manifest: ProjectManifest = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: request.name?.trim() || current?.name || slug,
    files,
    dxfTransform: request.dxfTransform ?? current?.dxfTransform ?? { rotationDegrees: 0, origin: null },
    view: { showGrid: true, showRapidMoves: true, ...current?.view, ...request.view },
    updatedAt: new Date().toISOString(),
  };
  await atomicJsonWrite(path.join(directory, "project.json"), manifest);
  return manifest;
}

async function readProjectInput(directory: string, relativePath: string | undefined) {
  if (!relativePath) return null;
  const resolved = path.resolve(directory, relativePath);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error("Ungültiger Dateipfad im Projektmanifest.");
  return readFile(resolved, "utf8");
}

export async function loadProject(slug: string): Promise<LoadedProject> {
  const directory = projectDirectory(slug);
  const manifest = await readManifest(slug);
  const [dxf, gcode] = await Promise.all([
    readProjectInput(directory, manifest.files.dxf?.path),
    readProjectInput(directory, manifest.files.gcode?.path),
  ]);
  return { slug, manifest, contents: { dxf, gcode } };
}
