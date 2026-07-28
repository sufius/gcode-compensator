import { NextResponse } from "next/server";
import { deleteProject, loadProject, saveProject } from "@/lib/project-storage";
import type { SaveProjectRequest } from "@/lib/project";

export const runtime = "nodejs";

type Context = { params: Promise<{ project: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { project } = await context.params;
    return NextResponse.json(await loadProject(project));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Projekt konnte nicht geladen werden." }, { status: 404 });
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { project } = await context.params;
    const body = await request.json() as SaveProjectRequest;
    return NextResponse.json({ slug: project, manifest: await saveProject(project, body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Projekt konnte nicht gespeichert werden." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { project } = await context.params;
    await deleteProject(project);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Projekt konnte nicht gelöscht werden." }, { status: 400 });
  }
}
