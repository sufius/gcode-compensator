import { NextResponse } from "next/server";
import { createProject, listProjects, projectSlug } from "@/lib/project-storage";
import type { SaveProjectRequest } from "@/lib/project";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as SaveProjectRequest & { name?: string };
    if (!body.name?.trim()) return NextResponse.json({ error: "Bitte einen Projektnamen angeben." }, { status: 400 });
    const manifest = await createProject(body.name, body);
    return NextResponse.json({ slug: projectSlug(body.name), manifest }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Projekt konnte nicht erstellt werden.";
    return NextResponse.json({ error: message }, { status: message.includes("existiert bereits") ? 409 : 400 });
  }
}
