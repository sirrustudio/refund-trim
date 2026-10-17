/**
 * The injected script must never run where a password or 2FA code is typed.
 * Three checks cover it: the screen injects nothing on login URLs
 * (isNoScriptUrl), the script exits on its first lines if it lands on one
 * anyway, and it switches itself off on any page with a password field
 * (Instagram's login form also appears at "/").
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
    // Whole segments only: a profile named "challenger" isn't a login page.
    "https://www.instagram.com/challenger/",
    // Another site's login page isn't ours to judge (it opens in Safari).
    "https://evil.example/accounts/login/",
    "not a url",
  ])("not a login page: %s", (url) => {
    expect(isNoScriptUrl(instagram, url)).toBe(false);
  });
});

// Runs the real script against a fake page at `path`. The style tag (which
// hides "Open app") is what disappears while the script is off.
function runScriptAt(path: string) {
  const script = buildLiteInjection(instagram, { reelLimit: 0 });
  const sent: string[] = [];
  const page = { hasPasswordField: false, styleOn: false };
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
    ReactNativeWebView: {
      postMessage: (message: string) => sent.push(message),
    },
    addEventListener: () => {},
  };
  const fakeLocation = {
    pathname: path,
    href: `https://www.instagram.com${path}`,
  };
  const fakeHistory = { pushState: () => {}, replaceState: () => {} };
  const fakeDocument = {
    hidden: false,
    head,
    createElement: () => style,
    querySelector: () => (page.hasPasswordField ? {} : null),
    // No site bottom bar on this page.
    querySelectorAll: () => [],
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      listeners[name] = listener;
    },
  };
  const fakeSetInterval = (callback: () => void) => {
    tick = callback; // the last interval set up is the password-field check
  };
  // The bar copy's delayed checks aren't part of this test, and real timers
  // would keep Jest running after it finishes.
  const fakeSetTimeout = () => 0;
  new Function(
    "window",
    "location",
    "history",
    "document",
    "setInterval",
    "setTimeout",
    script,
  )(
    fakeWindow,
    fakeLocation,
    fakeHistory,
    fakeDocument,
    fakeSetInterval,
    fakeSetTimeout,
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

describe("off while a password field is on the page", () => {
  // Instagram shows its login form at "/" too, so the URL can't tell; the
  // field can.
  it("switches off: removes its style and sends nothing", () => {
    const run = runScriptAt("/");
    run.page.hasPasswordField = true;
    run.tick();
    expect(run.page.styleOn).toBe(false);
    run.pushState();
    expect(run.sent).toEqual([]);
  });

  it("switches off as soon as the field gets focus", () => {
    const run = runScriptAt("/");
    run.page.hasPasswordField = true;
    run.focus({ matches: () => true });
    expect(run.page.styleOn).toBe(false);
  });

  it("comes back on once the field is gone, and reports the URL", () => {
    const run = runScriptAt("/");
    run.page.hasPasswordField = true;
    run.tick();
    run.page.hasPasswordField = false;
    run.tick();
    expect(run.page.styleOn).toBe(true);
    expect(run.sent).toEqual([
      JSON.stringify({ type: "nav", url: "https://www.instagram.com/" }),
    ]);
  });
});
