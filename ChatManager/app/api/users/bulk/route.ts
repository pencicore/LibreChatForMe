import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { createCompetitionUsers } from '@/lib/users';

export async function POST(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    prefix?: string;
    domain?: string;
    count?: number;
    startIndex?: number;
    password?: string;
    namePrefix?: string;
    role?: string;
    emailVerified?: boolean;
    tenantId?: string;
  };

  const prefix = body.prefix?.trim().toLowerCase() || 'contestant';
  const domain = body.domain?.trim().toLowerCase() || 'competition.local';
  const count = Number(body.count);
  const startIndex = Number(body.startIndex || 1);
  const password = body.password?.trim();

  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    return NextResponse.json({ error: 'count must be an integer between 1 and 1000' }, { status: 400 });
  }

  if (!Number.isInteger(startIndex) || startIndex < 1) {
    return NextResponse.json({ error: 'startIndex must be a positive integer' }, { status: 400 });
  }

  if (!password || password.length < 8 || password.length > 128) {
    return NextResponse.json({ error: 'password must be 8-128 characters' }, { status: 400 });
  }

  const result = await createCompetitionUsers({
    prefix,
    domain,
    count,
    startIndex,
    password,
    namePrefix: body.namePrefix?.trim() || '选手 ',
    role: body.role?.trim() || 'USER',
    emailVerified: body.emailVerified ?? true,
    tenantId: body.tenantId?.trim() || undefined,
  });

  return NextResponse.json(result, { status: 201 });
}
