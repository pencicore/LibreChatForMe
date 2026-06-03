import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { buildUserSearch, listUsers, usersToCsv } from '@/lib/users';
import { parsePositiveInt } from '@/lib/http';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveInt(searchParams.get('limit'), 5000, 10000);
  const filter = buildUserSearch(
    searchParams.get('q'),
    searchParams.get('role'),
    searchParams.get('status'),
    searchParams.get('dateRange'),
  );

  const result = await listUsers({ filter, page: 1, limit });
  const csv = usersToCsv(result.users);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="librechat-users-${Date.now()}.csv"`,
    },
  });
}
