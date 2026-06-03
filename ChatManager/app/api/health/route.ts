import { NextResponse } from 'next/server';
import { repairAllLegacyBanRecords } from '@/lib/ban';
import { collections } from '@/lib/db';
import { requireAdminToken } from '@/lib/auth';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { users } = await collections();
  const [userCount, legacyBansFixed] = await Promise.all([
    users.estimatedDocumentCount(),
    repairAllLegacyBanRecords(),
  ]);

  return NextResponse.json({
    ok: true,
    database: 'connected',
    users: userCount,
    legacyBansFixed,
  });
}
