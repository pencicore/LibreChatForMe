import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { deleteUsersByIds, updateUserById } from '@/lib/users';

export async function POST(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    ids?: string[];
    action?: 'disable' | 'enable' | 'delete' | 'verify';
  };

  const ids = (body.ids ?? []).filter((id) => ObjectId.isValid(id));

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No valid user ids provided' }, { status: 400 });
  }

  if (body.action === 'delete') {
    await deleteUsersByIds(ids);
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  for (const id of ids) {
    if (body.action === 'disable') {
      await updateUserById(id, { disabled: true });
    } else if (body.action === 'enable') {
      await updateUserById(id, { disabled: false, emailVerified: true });
    } else if (body.action === 'verify') {
      await updateUserById(id, { emailVerified: true });
    }
  }

  return NextResponse.json({ ok: true, affected: ids.length });
}
