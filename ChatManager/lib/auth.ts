import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';
import type { SessionUser } from '@/lib/librechat-auth';
import { SESSION_COOKIE } from '@/lib/session';

type JwtPayload = {
  id?: string;
  email?: string;
  username?: string;
};

export function isAuthRequired() {
  return Boolean(process.env.JWT_SECRET?.trim() || process.env.CHAT_MANAGER_ADMIN_TOKEN?.trim());
}

export function getTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';

  if (header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) {
      return token;
    }
  }

  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`));

  if (match?.[1]) {
    return decodeURIComponent(match[1]);
  }

  return null;
}

export function verifySessionToken(token: string): SessionUser | null {
  const staticToken = process.env.CHAT_MANAGER_ADMIN_TOKEN?.trim();

  if (staticToken && token === staticToken) {
    return {
      id: 'static-admin',
      email: 'static-token',
      name: 'API Token',
      role: 'ADMIN',
    };
  }

  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    return null;
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload;

    if (!payload?.id) {
      return null;
    }

    return {
      id: payload.id,
      email: payload.email ?? '',
      username: payload.username,
    };
  } catch {
    return null;
  }
}

export function requireAdminToken(request: Request) {
  if (!isAuthRequired()) {
    return null;
  }

  const token = getTokenFromRequest(request);

  if (!token || !verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export function getSessionUser(request: Request): SessionUser | null {
  const token = getTokenFromRequest(request);

  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}
