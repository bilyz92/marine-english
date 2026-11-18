import { describe, expect, it } from "vitest";
import { INSTALL_PARAM, browserKind, openInChromeUrl, openInSafariUrl } from "@/lib/install-links";

const PAGE = "https://conghung.ce-tanker.vn/khoa-hoc/mea_ce_tanker?x=1#top";

describe("openInChromeUrl", () => {
  it("mở đúng trang trong Chrome Android, kèm dấu hiệu tự mở hướng dẫn cài và trang dự phòng", () => {
    const url = openInChromeUrl(PAGE);
    expect(url).toBe(
      "intent://conghung.ce-tanker.vn/khoa-hoc/mea_ce_tanker?x=1&cai=1#Intent;scheme=https;package=com.android.chrome;"
        + `S.browser_fallback_url=${encodeURIComponent("https://conghung.ce-tanker.vn/khoa-hoc/mea_ce_tanker?x=1&cai=1")};end`,
    );
  });
});

describe("openInSafariUrl", () => {
  it("dùng x-safari-https, giữ đường dẫn và thêm dấu hiệu cài", () => {
    expect(openInSafariUrl(PAGE)).toBe("x-safari-https://conghung.ce-tanker.vn/khoa-hoc/mea_ce_tanker?x=1&cai=1");
  });
  it("không nhân đôi dấu hiệu khi trang đã có", () => {
    expect(openInSafariUrl(`https://a.vn/?${INSTALL_PARAM}=1`)).toBe("x-safari-https://a.vn/?cai=1");
  });
});

describe("browserKind", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
  it.each([
    [IPHONE, "ios-safari"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1", "ios-other"],
    [`${IPHONE} Zalo iOS/510`, "ios-in-app"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]", "ios-in-app"],
    [ANDROID, "android"],
    [`${ANDROID} Zalo android/12100`, "android-in-app"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", "other"],
  ])("%s → %s", (ua, kind) => {
    expect(browserKind(ua, 0)).toBe(kind);
  });
  it("iPad báo là Mac nhưng có màn cảm ứng → iPhone/iPad", () => {
    expect(browserKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", 5)).toBe("ios-safari");
  });
});
