import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { getUserStats } from '@/lib/users';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const stats = await getUserStats();
  return NextResponse.json({ stats });
}
