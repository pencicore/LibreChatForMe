import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { importUsersFromCsv } from '@/lib/users';

export async function POST(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const defaultPassword = String(formData.get('defaultPassword') ?? '').trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'CSV file is required' }, { status: 400 });
  }

  if (!defaultPassword || defaultPassword.length < 8) {
    return NextResponse.json({ error: 'defaultPassword must be at least 8 characters' }, { status: 400 });
  }

  const content = await file.text();
  const result = await importUsersFromCsv(content, defaultPassword);

  return NextResponse.json(result, { status: 201 });
}
