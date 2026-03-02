import { auth } from '@/auth';

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { nextUrl } = req;

  // Rotas públicas que nunca requerem login
  const isPublicRoute = nextUrl.pathname.startsWith('/share/') || nextUrl.pathname === '/share';

  // Protect /workspace/history, /workspace/settings, and any other sub-routes of workspace
  // Leave /workspace alone (exact match)
  const isProtectedRoute =
    !isPublicRoute &&
    nextUrl.pathname.startsWith('/workspace/') &&
    nextUrl.pathname !== '/workspace';
  const isAuthRoute = nextUrl.pathname.startsWith('/login');

  if (isAuthRoute) {
    if (isLoggedIn) {
      return Response.redirect(new URL('/workspace', nextUrl));
    }
    return null;
  }

  if (!isLoggedIn && isProtectedRoute) {
    return Response.redirect(new URL('/login', nextUrl));
  }

  return null;
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
