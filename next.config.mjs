import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  // Allow opening `next dev` via LAN / Tailscale hostnames (otherwise /_next/*
  // is blocked, React never hydrates, and forms just reload the page).
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "10.0.50.32",
    "watchpot.ts.thedevlab.co",
    "*.ts.thedevlab.co",
  ],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
