import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marine English",
    short_name: "Marine English",
    description: "Học tiếng Anh cho thuyền viên máy, học được khi không có mạng",
    start_url: "/hoc",
    scope: "/",
    display: "standalone",
    background_color: "#F7F4FD",
    theme_color: "#5B21B6",
    lang: "vi",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
