import { NextResponse } from 'next/server';
import { requireAdminToken } from '@/lib/auth';
import { deleteConversation, getConversationDetail, updateConversationMeta } from '@/lib/conversations';
import { parsePositiveInt } from '@/lib/http';

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { conversationId } = await context.params;
  const { searchParams } = new URL(request.url);
  const messagePage = parsePositiveInt(searchParams.get('messagePage'), 1, 10000);
  const messageLimit = parsePositiveInt(searchParams.get('messageLimit'), 20, 500);

  const detail = await getConversationDetail(conversationId, messagePage, messageLimit);

  if (!detail) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  return NextResponse.json({ conversation: detail });
}

export async function PATCH(request: Request, context: RouteContext) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { conversationId } = await context.params;
  const body = (await request.json()) as {
    tags?: string[];
    chatManagerNotes?: string;
    archived?: boolean;
  };

  const result = await updateConversationMeta(conversationId, body);

  if (!result) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const unauthorized = requireAdminToken(_request);
  if (unauthorized) {
    return unauthorized;
  }

  const { conversationId } = await context.params;
  await deleteConversation(conversationId);
  return NextResponse.json({ ok: true });
}
