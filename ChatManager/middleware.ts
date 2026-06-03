import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAuthRequired } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/session'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function middleware(request: NextRequest) {
  if (!isAuthRequired() || isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get(SESSION_COOKIE)?.value;
  const authHeader = request.headers.get('authorization') ?? '';
  const headerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';

  if (cookieToken || headerToken) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
