import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { formats: ["image/avif", "image/webp"] },
  poweredByHeader: false,
  // the Blob-sync worker is loaded by path at runtime, so ship it with every function
  outputFileTracingIncludes: { "/**/*": ["./vendor/**"] },
  experimental: { serverActions: { bodySizeLimit: "25mb" } }, // inspector photo uploads from phones
};

export default nextConfig;
