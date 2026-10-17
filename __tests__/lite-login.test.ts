/**
 * Lite keeps its script off Instagram's login pages, so no Refund code runs
 * where a password or 2FA code is typed. Three checks do it: the screen hands
 * over no script for a login address (isNoScriptUrl), the script stops on its
 * first lines if it lands on one anyway (the backup), and it switches itself
 * off on ANY page with a password box (Instagram's login also lives at "/").
 */
import { isNoScriptUrl } from "@/utils/lite-filter";
import { buildLiteInjection } from "@/utils/lite-inject";
import { findLiteSite } from "@/utils/lite-sites";

const instagram = findLiteSite("instagram")!;

describe("isNoScriptUrl", () => {
  it.each([
    "https://www.instagram.com/accounts/login/",
    "https://www.instagram.com/accounts/login/?next=%2Fdirect%2Finbox%2F",
    "https://www.instagram.com/two_factor/?next=%2F",
    "https://www.instagram.com/challenge/action/abc/",
    "https://WWW.INSTAGRAM.COM/Accounts/Login/",
  ])("login page: %s", (url) => {
    expect(isNoScriptUrl(instagram, url)).toBe(true);
  });

  it.each([
    "https://www.instagram.com/direct/inbox/",
    "https://www.instagram.com/reels/",
    "https://www.instagram.com/accounts/edit/",
    // Whole path pieces only: a profile named "challenger" is not a login page.
    "https://www.instagram.com/challenger/",
    // Another site's login page is not ours to judge (it opens in Safari).
    "https://evil.example/accounts/login/",
    "not a url",
  ])("not a login page: %s", (url) => {
    expect(isNoScriptUrl(instagram, url)).toBe(false);
  });
});

// Runs the script against a pretend page at `path`. Its style (the hidden
// "Open app" button) is what goes away while it's off. `hasPasswordBox`
// stands in for the page.
function runScriptAt(path: string) {
  const script = buildLiteInjection(instagram, { reelLimit: 0 });
  const sent: string[] = [];
  const page = { hasPasswordBox: false, styleOn: false };
  const listeners: Record<string, (event: unknown) => void> = {};
  let tick = () => {};
  const style = {
    textContent: "",
    get parentNode() {
      return page.styleOn ? head : null;
    },
  };
  const head = {
    appendChild: () => {
      page.styleOn = true;
    },
    removeChild: () => {
      page.styleOn = false;
    },
  };
  const fakeWindow: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (message: string) => sent.push(message) },
    addEventListener: () => {},
  };
  const fakeLocation = { pathname: path, href: `https://www.instagram.com${path}` };
  const fakeHistory = { pushState: () => {}, replaceState: () => {} };
  const fakeDocument = {
    hidden: false,
    head,
    createElement: () => style,
    querySelector: () => (page.hasPasswordBox ? {} : null),
    // The bottom-bar finder looks for the site's own bar: none on this page.
    querySelectorAll: () => [],
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      listeners[name] = listener;
    },
  };
  const fakeSetInterval = (callback: () => void) => {
    tick = callback; // the last one set up is the password-box check
  };
  new Function("window", "location", "history", "document", "setInterval", script)(
    fakeWindow,
    fakeLocation,
    fakeHistory,
    fakeDocument,
    fakeSetInterval,
  );
  return {
    window: fakeWindow,
    page,
    sent,
    tick: () => tick(),
    pushState: () => fakeHistory.pushState(),
    focus: (target: unknown) => listeners.focusin?.({ target }),
  };
}

describe("the script's backup check", () => {
  it("stops at once on a login page", () => {
    expect(runScriptAt("/accounts/login/").window.__refundLite).toBeUndefined();
    expect(runScriptAt("/two_factor/").window.__refundLite).toBeUndefined();
  });

  it("sets up as usual on any other page", () => {
    const run = runScriptAt("/direct/inbox/");
    expect(run.window.__refundLite).toBe(true);
    expect(run.page.styleOn).toBe(true);
  });
});

describe("off while a password box is on the page", () => {
  // Instagram shows its login form at "/" too, the home feed's address, so
  // the address can't tell; the box can.
  it("switches off: removes its style and sends nothing", () => {
    const run = runScriptAt("/");
    run.page.hasPasswordBox = true;
    run.tick();
    expect(run.page.styleOn).toBe(false);
    run.pushState();
    expect(run.sent).toEqual([]);
  });

  it("switches off at once when the box is tapped", () => {
    const run = runScriptAt("/");
    run.page.hasPasswordBox = true;
    run.focus({ matches: () => true });
    expect(run.page.styleOn).toBe(false);
  });

  it("comes back on once the box is gone, and reports the address", () => {
    const run = runScriptAt("/");
    run.page.hasPasswordBox = true;
    run.tick();
    run.page.hasPasswordBox = false;
    run.tick();
    expect(run.page.styleOn).toBe(true);
    expect(run.sent).toEqual([
      JSON.stringify({ type: "nav", url: "https://www.instagram.com/" }),
    ]);
  });
});
