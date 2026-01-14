import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Skip auth in development if desired
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
    return NextResponse.next();
  }

  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    try {
      const [, credentials] = authHeader.split(' ');
      const decoded = atob(credentials);
      const [user, pass] = decoded.split(':');

      if (user === process.env.AUTH_USER && pass === process.env.AUTH_PASS) {
        return NextResponse.next();
      }
    } catch {
      // Invalid auth header format
    }
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="MT5 Trader"',
    },
  });
}

export const config = {
  matcher: [
    // Match all paths except static files and images
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
