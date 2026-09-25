import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR === ".next-share" ? ".next-share" : ".next",
  async rewrites() {
    const backend = process.env.BACKEND_URL || "http://127.0.0.1:18011";
    return [{ source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` }];
  },
};

export default nextConfig;
