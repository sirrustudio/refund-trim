/**
 * Instagram's "Open app" links go to applink.instagram.com, which opens the
 * native (often locked) app. Lite ignores them: they aren't loaded, and
 * aren't sent to Safari either, which would pass them on to the app.
 */
import { checkLiteUrl } from "@/utils/lite-filter";
import { findLiteSite } from "@/utils/lite-sites";

const instagram = findLiteSite("instagram")!;

it.each([
  "https://applink.instagram.com/instagram/?utm_source=igweb&fall_back_to_web=false",
  // Short links claimed by Instagram's app; Safari would pass these on too.
  "https://ig.me/m/someone",
  "https://instagr.am/p/abc123/",
])("ignores Instagram's open-the-app link %s", (url) => {
  expect(checkLiteUrl(instagram, url)).toBe("ignore");
});

it("still loads the rest of Instagram", () => {
  expect(
    checkLiteUrl(instagram, "https://www.instagram.com/direct/inbox/"),
  ).toBe("allow");
  expect(checkLiteUrl(instagram, "https://instagram.com/someone/")).toBe(
    "allow",
  );
});

it("still sends other websites to Safari", () => {
  expect(checkLiteUrl(instagram, "https://example.com/")).toBe("external");
});
