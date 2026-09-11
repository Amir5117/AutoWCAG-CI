import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @axe-core/playwright reads its injected script via Node-specific
  // mechanisms that Turbopack's server bundling mangles (surfaces at
  // runtime as "ReferenceError: module is not defined" inside the page
  // context). `playwright` itself is auto-externalized by Next.js already;
  // this package isn't on that default list, so it needs to be added
  // explicitly.
  serverExternalPackages: ["@axe-core/playwright"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
