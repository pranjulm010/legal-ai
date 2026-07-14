import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's dev server blocks cross-origin requests to _next dev resources
  // (HMR websocket, etc.) by default, since the ngrok domain differs from
  // localhost. Without this, HMR silently 503s and the app can end up only
  // partially hydrated - forms then fall back to native browser submission
  // instead of the React onSubmit handler.
  allowedDevOrigins: ["remedial-paternal-washcloth.ngrok-free.dev"],
  // Django's ninja routes all require a trailing slash (APPEND_SLASH). Next's
  // :path* rewrite capture strips any trailing slash from the incoming
  // request before building the destination, so without forcing it back
  // here, Django's APPEND_SLASH redirect and Next's rewrite fight forever
  // (infinite redirect loop).
  skipTrailingSlashRedirect: true,
  // Proxies /api/* to the local Django backend so the browser only ever
  // talks to one origin (this Next.js app) - lets a single ngrok tunnel
  // on the frontend serve both, without needing a second public endpoint
  // for the backend (ngrok's free tier only allows one).
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/api/:path*/",
      },
    ];
  },
};

export default nextConfig;
