import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { getAdminForOperationLog, logAdminOperation } from '@/lib/admin-operation-logs';
import { requireAdminToken } from '@/lib/auth';
import { buildUserSearch, listUsers, updateUserById, userAuditLabel } from '@/lib/users';
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

  const changedFields = ['name', 'username', 'role', 'emailVerified', 'tenantId'].filter(
    (field) => body[field as keyof typeof body] !== undefined,
  );
  const logTasks: Promise<void>[] = [];
  const accountLabel = userAuditLabel(user);

  if (typeof body.disabled === 'boolean') {
    logTasks.push(
      logAdminOperation({
        request,
        admin: getAdminForOperationLog(request),
        action: body.disabled ? 'USER_DISABLE' : 'USER_ENABLE',
        targetType: 'user',
        targetId: body.id,
        details: {
          mode: 'single',
          accountLabel,
          email: user.email,
          username: user.username,
        },
      }),
    );
  }

  if (changedFields.length > 0) {
    logTasks.push(
      logAdminOperation({
        request,
        admin: getAdminForOperationLog(request),
        action: 'USER_UPDATE',
        targetType: 'user',
        targetId: body.id,
        details: {
          changedFields,
          accountLabel,
          email: user.email,
          username: user.username,
        },
      }),
    );
  }

  await Promise.all(logTasks);

  return NextResponse.json({ user });
}
