import type { NextConfig } from "next";
import LOCAL_DEV_IP from "./local.env";

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: [LOCAL_DEV_IP],
  output: 'standalone',
};

export default nextConfig;
