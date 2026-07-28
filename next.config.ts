import type { NextConfig } from "next";
import LOCAL_DEV_IP from "./local.env";

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: [LOCAL_DEV_IP],
  output: 'standalone',
  // Note: file tracing sweeps a populated dist/ into .next/standalone, so
  // `npm run package` clears it before building. Do not reach for
  // outputFileTracingExcludes to fix that - a 'dist/**/*' pattern also matches
  // node_modules/next/dist/**, which silently drops the compiled app-route
  // runtime and turns every API route into a 500 at request time.
};

export default nextConfig;
