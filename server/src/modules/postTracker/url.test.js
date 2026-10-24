import { describe, it, expect } from "vitest";
import { parseInstagramPostUrl, REASONS } from "./url.js";

// Post Tracker (24 Oct): every pasted shape of the same reel must land on one
// shortcode, and anything that isn't a single public reel/post must say why.
describe("parseInstagramPostUrl — accepted", () => {
  const reel = { ok: true, shortcode: "C9xYz_12-Ab", kind: "reel", canonicalUrl: "https://www.instagram.com/reel/C9xYz_12-Ab/", embedUrl: "https://www.instagram.com/reel/C9xYz_12-Ab/embed/captioned/" };

  it.each([
    "https://www.instagram.com/reel/C9xYz_12-Ab/",
    "https://www.instagram.com/reel/C9xYz_12-Ab",
    "http://instagram.com/reel/C9xYz_12-Ab/",
    "instagram.com/reel/C9xYz_12-Ab",
    "www.instagram.com/reel/C9xYz_12-Ab/",
    "https://m.instagram.com/reel/C9xYz_12-Ab/",
    "https://www.instagram.com/reels/C9xYz_12-Ab/",
    "https://www.instagram.com/tv/C9xYz_12-Ab/",
    "https://www.instagram.com/reel/C9xYz_12-Ab/?igsh=MWQ1ZGUxMzBkMA==",
    "https://www.instagram.com/reel/C9xYz_12-Ab/?utm_source=ig_web_copy_link&igshid=abc",
    "https://www.instagram.com/reel/C9xYz_12-Ab/#comments",
    "  https://www.instagram.com/reel/C9xYz_12-Ab/  ",
    "HTTPS://WWW.INSTAGRAM.COM/REEL/C9xYz_12-Ab/",
    "https://www.instagram.com/somepage/reel/C9xYz_12-Ab/",
    "Check out this reel! https://www.instagram.com/reel/C9xYz_12-Ab/?igsh=xyz so good",
  ])("%s → the same reel", (input) => {
    expect(parseInstagramPostUrl(input)).toEqual(reel);
  });

  it("keeps the shortcode's case (shortcodes are case-sensitive)", () => {
    expect(parseInstagramPostUrl("https://www.instagram.com/reel/C9xYz_12-Ab/").shortcode).toBe("C9xYz_12-Ab");
  });

  it.each(["https://www.instagram.com/p/DAbc123xyz/", "https://instagr.am/p/DAbc123xyz", "https://www.instagram.com/somepage/p/DAbc123xyz/?img_index=2"])(
    "%s → a post",
    (input) => {
      expect(parseInstagramPostUrl(input)).toEqual({
        ok: true,
        shortcode: "DAbc123xyz",
        kind: "post",
        canonicalUrl: "https://www.instagram.com/p/DAbc123xyz/",
        embedUrl: "https://www.instagram.com/p/DAbc123xyz/embed/captioned/",
      });
    }
  );
});

describe("parseInstagramPostUrl — rejected, with a reason", () => {
  it.each([
    ["", REASONS.empty],
    ["   ", REASONS.empty],
    [null, REASONS.empty],
    ["hello there", REASONS.notLink],
    ["https://www.youtube.com/watch?v=abc", REASONS.notInstagram],
    ["https://evil.example/instagram.com.html", REASONS.notInstagram],
    ["https://notinstagram.com/reel/C9xYz_12-Ab/", REASONS.notInstagram],
    ["https://instagram.com.evil.example/reel/C9xYz_12-Ab/", REASONS.notInstagram],
    ["https://www.instagram.com/somepage/", REASONS.profile],
    ["https://www.instagram.com/somepage?igsh=abc", REASONS.profile],
    ["https://www.instagram.com/", REASONS.notPost],
    ["https://www.instagram.com/explore/", REASONS.notPost],
    ["https://www.instagram.com/reels/", REASONS.notPost],
    ["https://www.instagram.com/reels/audio/123456789/", REASONS.notPost],
    ["https://www.instagram.com/reels/explore/", REASONS.notPost],
    ["https://www.instagram.com/constructor/ABCDEFG/", REASONS.notPost],
    ["https://www.instagram.com/__proto__/ABCDEFG/", REASONS.notPost],
    ["https://www.instagram.com/somepage/hasOwnProperty/ABCDEFG/", REASONS.notPost],
    ["https://www.instagram.com/somepage/tagged/", REASONS.notPost],
    ["https://www.instagram.com/stories/somepage/3456789012345678901/", REASONS.story],
    ["https://www.instagram.com/stories/highlights/17890000000000000/", REASONS.story],
    ["https://www.instagram.com/s/aGlnaGxpZ2h0OjE3OD/", REASONS.story],
    ["https://www.instagram.com/share/reel/BAabcdEFgh/", REASONS.share],
    ["https://www.instagram.com/reel/ab/", REASONS.badCode],
    ["https://www.instagram.com/reel/abc$def/", REASONS.badCode],
  ])("%j → %s", (input, reason) => {
    expect(parseInstagramPostUrl(input)).toEqual({ ok: false, reason });
  });

  it("never lets anything but the shortcode into the embed link", () => {
    const r = parseInstagramPostUrl('https://www.instagram.com/reel/C9xYz_12-Ab/"><script>alert(1)</script>');
    expect(r.embedUrl).toBe("https://www.instagram.com/reel/C9xYz_12-Ab/embed/captioned/");
  });
});
