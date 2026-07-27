import { NextResponse } from "next/server";
import { createProjectVersion, deleteProjectVersion, switchProjectVersion } from "@/lib/project-storage";
import type { ProjectManifest, ProjectUpload } from "@/lib/project";

export const runtime = "nodejs";
type Context = { params: Promise<{ project: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { project } = await context.params;
    const body = await request.json() as { gcode?: ProjectUpload; dxfTransform?: ProjectManifest["dxfTransform"]; label?: string };
    if (!body.gcode || !body.dxfTransform) return NextResponse.json({ error: "G-Code und DXF-Transformation werden benötigt." }, { status: 400 });
    return NextResponse.json(await createProjectVersion(project, body.gcode, body.dxfTransform, body.label), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Version konnte nicht angelegt werden." }, { status: 400 });
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { project } = await context.params;
    const body = await request.json() as { versionId?: string };
    if (!body.versionId) return NextResponse.json({ error: "Versions-ID fehlt." }, { status: 400 });
    return NextResponse.json(await switchProjectVersion(project, body.versionId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Version konnte nicht geladen werden." }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { project } = await context.params;
    const body = await request.json() as { versionId?: string };
    if (!body.versionId) return NextResponse.json({ error: "Versions-ID fehlt." }, { status: 400 });
    return NextResponse.json(await deleteProjectVersion(project, body.versionId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Version konnte nicht gelöscht werden." }, { status: 400 });
  }
}
