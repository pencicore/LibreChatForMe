import { NextResponse } from 'next/server';

export function requireAdminToken(request: Request) {
  const expected = process.env.CHAT_MANAGER_ADMIN_TOKEN?.trim();

  if (!expected) {
    return null;
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

  if (token === expected) {
    return null;
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
