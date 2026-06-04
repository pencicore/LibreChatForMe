import { NextResponse } from 'next/server';
import { getAdminForOperationLog, logAdminOperation } from '@/lib/admin-operation-logs';
import { requireAdminToken } from '@/lib/auth';
import {
  deleteConversation,
  getConversationAuditLabel,
  getConversationDetail,
  updateConversationMeta,
} from '@/lib/conversations';
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

  if (typeof body.archived === 'boolean') {
    await logAdminOperation({
      request,
      admin: getAdminForOperationLog(request),
      action: body.archived ? 'CONVERSATION_ARCHIVE' : 'CONVERSATION_UNARCHIVE',
      targetType: 'conversation',
      targetId: conversationId,
      details: {
        archived: body.archived,
        conversationTitle: typeof result.title === 'string' ? result.title : undefined,
      },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: RouteContext) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { conversationId } = await context.params;
  const conversationTitle = await getConversationAuditLabel(conversationId);
  await deleteConversation(conversationId);
  await logAdminOperation({
    request,
    admin: getAdminForOperationLog(request),
    action: 'CONVERSATION_DELETE',
    targetType: 'conversation',
    targetId: conversationId,
    details: {
      conversationTitle,
    },
  });
  return NextResponse.json({ ok: true });
}
