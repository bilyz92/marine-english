import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marine English",
    short_name: "Marine English",
    description: "Học tiếng Anh cho thuyền viên máy, học được khi không có mạng",
    start_url: "/hoc",
    scope: "/",
    display: "standalone",
    background_color: "#EDF1ED",
    theme_color: "#0B0F0B",
    lang: "vi",
    // Android cần icon PNG 192 và 512 để cài; SVG cho trình duyệt hiểu được.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
