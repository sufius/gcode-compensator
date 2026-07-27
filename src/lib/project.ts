import type { Point } from "./geometry";

export const PROJECT_SCHEMA_VERSION = 1 as const;

export type ProjectFile = {
  path: string;
  originalName: string;
  sha256: string;
};

export type ProjectManifest = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  name: string;
  files: {
    dxf: ProjectFile | null;
    gcode: ProjectFile | null;
  };
  dxfTransform: {
    rotationDegrees: number;
    origin: Point | null;
  };
  view: {
    showGrid: boolean;
    showRapidMoves: boolean;
  };
  updatedAt: string;
  versions?: ProjectVersion[];
  currentVersion?: string;
};

export type ProjectVersion = {
  id: string;
  createdAt: string;
  label: string;
  gcodePath: string;
  gcodeSha256: string;
  dxfTransform: ProjectManifest["dxfTransform"];
};

export type ProjectSummary = {
  slug: string;
  name: string;
  updatedAt: string;
  hasDxf: boolean;
  hasGcode: boolean;
};

export type ProjectUpload = { name: string; content: string };

export type SaveProjectRequest = {
  name?: string;
  files?: {
    dxf?: ProjectUpload | null;
    gcode?: ProjectUpload | null;
  };
  dxfTransform?: ProjectManifest["dxfTransform"];
  view?: Partial<ProjectManifest["view"]>;
};

export type LoadedProject = {
  slug: string;
  manifest: ProjectManifest;
  contents: {
    dxf: string | null;
    gcode: string | null;
  };
};
