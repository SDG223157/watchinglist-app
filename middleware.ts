import { auth } from "@/auth";

export default auth((req) => {
  if (!req.auth && !req.nextUrl.pathname.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return Response.redirect(url);
  }
});

export const config = {
  matcher: [
    "/((?!api/|login|_next/static|_next/image|icon\\.svg|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp|woff|woff2)$).*)",
  ],
};
