import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { deleteUserById, updateUserById } from '@/lib/users';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await context.params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Valid user id is required' }, { status: 400 });
  }

  const body = (await request.json()) as {
    name?: string;
    username?: string;
    role?: string;
    emailVerified?: boolean;
    disabled?: boolean;
    tenantId?: string;
  };

  const user = await updateUserById(id, body);

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const unauthorized = requireAdminToken(_request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await context.params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Valid user id is required' }, { status: 400 });
  }

  await deleteUserById(id);
  return NextResponse.json({ ok: true });
}
