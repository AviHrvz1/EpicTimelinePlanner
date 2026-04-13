import type { NextConfig } from "next";
import path from "node:path";

/** When the repo root also has @prisma/client, webpack can pick the wrong generated client. Pin to this app. */
const prismaClientPackage = path.join(__dirname, "node_modules/@prisma/client");

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  /** Dev HMR WebSocket when the browser host differs from the server (e.g. 127.0.0.1 vs localhost). */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: path.join(__dirname),
    /** Turbopack requires project-relative paths here (absolute paths break the build). */
    resolveAlias: {
      "@prisma/client": "./node_modules/@prisma/client",
    },
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string | false | string[] | undefined>),
      "@prisma/client": prismaClientPackage,
    };
    return config;
  },
};

export default nextConfig;
