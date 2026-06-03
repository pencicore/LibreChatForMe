import { NextResponse } from 'next/server';
import { collections } from '@/lib/db';
import { requireAdminToken } from '@/lib/auth';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { users } = await collections();
  const userCount = await users.estimatedDocumentCount();

  return NextResponse.json({
    ok: true,
    database: 'connected',
    users: userCount,
  });
}
