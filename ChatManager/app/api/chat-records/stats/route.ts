import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { getConversationStats } from '@/lib/conversations';

export async function GET(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const stats = await getConversationStats();
  return NextResponse.json({ stats });
}
