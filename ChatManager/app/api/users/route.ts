import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { buildUserSearch, listUsers, updateUserById } from '@/lib/users';
import { parsePositiveInt } from '@/lib/http';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveInt(searchParams.get('limit'), 20, 200);
  const page = parsePositiveInt(searchParams.get('page'), 1, 100000);
  const filter = buildUserSearch(
    searchParams.get('q'),
    searchParams.get('role'),
    searchParams.get('status'),
    searchParams.get('dateRange'),
  );

  const result = await listUsers({ filter, page, limit });

  return NextResponse.json({
    users: result.users,
    total: result.total,
    page,
    limit,
    stats: result.stats,
  });
}

export async function PATCH(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    id?: string;
    name?: string;
    username?: string;
    role?: string;
    emailVerified?: boolean;
    disabled?: boolean;
    tenantId?: string;
  };

  if (!body.id || !ObjectId.isValid(body.id)) {
    return NextResponse.json({ error: 'Valid user id is required' }, { status: 400 });
  }

  const user = await updateUserById(body.id, body);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user });
}
