import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { parseBulkCreateInput, previewCompetitionUsers, type BulkCreateBody } from '@/lib/users';

export async function POST(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as BulkCreateBody;
    const input = parseBulkCreateInput(body);
    const preview = await previewCompetitionUsers(input);
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
