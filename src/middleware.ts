import { auth } from '@/auth';

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { nextUrl } = req;

  // Protect /workspace/history, /workspace/settings, and any other sub-routes of workspace
  // Leave /workspace alone (exact match)
  const isProtectedRoute =
    nextUrl.pathname.startsWith('/workspace/') && nextUrl.pathname !== '/workspace';
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
