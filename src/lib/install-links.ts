// Nút “Tải app” (chủ 18/11/2026): từ trình duyệt trong Zalo/Facebook chuyển thẳng sang Chrome (Android) hay Safari (iPhone),
// trang mở ra với ?cai=1 thì tự hiện hướng dẫn cài. Chỉ là hàm thuần để kiểm bằng test.

export const INSTALL_PARAM = "cai";

export type BrowserKind = "ios-safari" | "ios-other" | "ios-in-app" | "android" | "android-in-app" | "other";

const IN_APP = /Zalo|FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\//i;

/** Loại trình duyệt theo user agent; iPad đời mới báo là Mac nên xét thêm số điểm chạm. */
export function browserKind(ua: string, maxTouchPoints: number): BrowserKind {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (ios) {
    if (IN_APP.test(ua)) return "ios-in-app";
    // Chrome, Firefox, Edge trên iPhone; Safari có "Version/x" và không có các dấu này. Trình duyệt trong app khác không có "Safari/".
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return "ios-other";
    return /Version\/[\d.]+.*Safari\//.test(ua) ? "ios-safari" : "ios-in-app";
  }
  if (/Android/.test(ua)) return IN_APP.test(ua) || /; wv\)/.test(ua) ? "android-in-app" : "android";
  return "other";
}

function withInstallParam(pageUrl: string): URL {
  const url = new URL(pageUrl);
  url.hash = "";
  url.searchParams.set(INSTALL_PARAM, "1");
  return url;
}

/** Link intent của Android: mở trang trong Chrome; máy không có Chrome thì trình duyệt mở trang dự phòng (cùng trang). */
export function openInChromeUrl(pageUrl: string): string {
  const url = withInstallParam(pageUrl);
  const rest = `${url.host}${url.pathname}${url.search}`;
  return `intent://${rest}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.toString())};end`;
}

/** Link mở trang bằng Safari (x-safari-https, có trên iOS 17 trở lên; máy cũ không mở được thì người dùng chép link). */
export function openInSafariUrl(pageUrl: string): string {
  const url = withInstallParam(pageUrl);
  return `x-safari-https://${url.host}${url.pathname}${url.search}`;
}
