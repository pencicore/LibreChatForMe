import { NextResponse } from 'next/server';
import { getSessionUser, isAuthRequired } from '@/lib/auth';

export async function GET(request: Request) {
  if (!isAuthRequired()) {
    return NextResponse.json({ authenticated: false, authRequired: false });
  }

  const user = getSessionUser(request);

  if (!user) {
    return NextResponse.json({ authenticated: false, authRequired: true }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, authRequired: true, user });
}
