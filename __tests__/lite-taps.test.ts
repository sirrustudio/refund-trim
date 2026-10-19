/**
 * The page script stops taps on links to switched-off sections before the
 * site handles them, sends Search past the Explore grid, hides suggested
 * posts, closes the keyboard like a chat app, says once when the site's
 * interface is drawn, and takes new settings without a reload.
 */
import { blockedLineFor, checkLiteUrl } from "@/utils/lite-filter";
import {
  buildLiteInjection,
  buildLiteUpdate,
  keyboardScript,
  parseLiteMessage,
} from "@/utils/lite-inject";
import {
  applyLiteBlocks,
  findLiteSite,
  type LiteSite,
} from "@/utils/lite-sites";

const instagram = findLiteSite("instagram")!;
const reelsOff = applyLiteBlocks(instagram, ["instagram-reels"]);
const exploreOff = applyLiteBlocks(instagram, ["instagram-explore"]);
const dmsOnly = applyLiteBlocks(instagram, ["instagram-dms-only"]);
const nothingOff = applyLiteBlocks(instagram, []);
const suggestedOff = applyLiteBlocks(instagram, ["instagram-hide-suggested"]);

type Listener = (event?: unknown) => void;
type Sent = { type: string; url?: string };

/** Runs the real script on a fake Instagram page. */
function runPage(site: LiteSite, path = "/direct/inbox/") {
  const sent: Sent[] = [];
  const listeners: Record<string, Listener[]> = {};
  const page = { passwordField: false, drawn: false };
  const fakeWindow: Record<string, unknown> = {
    innerWidth: 390,
    innerHeight: 844,
    ReactNativeWebView: {
      postMessage: (message: string) => sent.push(JSON.parse(message)),
    },
    addEventListener: () => {},
    dispatchEvent: jest.fn(),
    scrollTo: jest.fn(),
  };
  const fakeDocument = {
    hidden: false,
    // No body yet, so the edge colours and the bar copy stay out of it.
    body: null,
    head: { appendChild: () => {}, removeChild: () => {} },
    documentElement: { classList: { add() {}, remove() {}, toggle() {} } },
    createElement: () => ({ textContent: "", parentNode: null }),
    querySelector: (selector: string) => {
      if (selector.includes('type="password"')) {
        return page.passwordField ? {} : null;
      }
      if (selector === site.readySelector) return page.drawn ? {} : null;
      return null;
    },
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    addEventListener: (name: string, listener: Listener) => {
      (listeners[name] ??= []).push(listener);
    },
  };
  const here = new URL(path, "https://www.instagram.com");
  const location = {
    pathname: here.pathname,
    search: here.search,
    hostname: here.hostname,
    href: here.href,
    assign: jest.fn(),
  };
  const pushState = jest.fn();
  const history = { pushState, replaceState: () => {} };
  let tick = () => {};
  new Function(
    "window",
    "document",
    "location",
    "history",
    "setInterval",
    "setTimeout",
    "PopStateEvent",
    buildLiteInjection(site, { reelLimit: 0 }),
  )(
    fakeWindow,
    fakeDocument,
    location,
    history,
    // The last interval set up is the once-a-second check.
    (callback: () => void) => {
      tick = callback;
    },
    () => 0,
    class {
      constructor(readonly type: string) {}
    },
  );

  /** Taps a link, the way the browser hands the tap to each listener. */
  function tap(href: string) {
    const url = new URL(href, location.href);
    const link = {
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      href: url.href,
    };
    const event = {
      target: {
        closest: (selector: string) => (selector === "a[href]" ? link : null),
      },
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
    };
    for (const listener of listeners.click ?? []) {
      if (event.stopped) break;
      listener(event);
    }
    return { stopped: event.defaultPrevented && event.stopped };
  }

  return {
    sent,
    page,
    tap,
    /** Addresses the page moved to in place (pushState). */
    moves: () => pushState.mock.calls.map((call) => call[2]),
    scrolledToTop: () => (fakeWindow.scrollTo as jest.Mock).mock.calls.length,
    tick: () => tick(),
    update: (script: string) => new Function("window", script)(fakeWindow),
  };
}

describe("a tap on a switched-off link", () => {
  it.each(["/reel/abc/", "/reels/", "/someone/reel/abc/"])(
    "is stopped before the site sees it, and the app is told: %s",
    (path) => {
      const page = runPage(reelsOff);
      expect(page.tap(path).stopped).toBe(true);
      expect(page.sent).toEqual([
        { type: "tapBlocked", url: `https://www.instagram.com${path}` },
      ]);
    },
  );

  it.each(["/someone/", "/direct/t/123/", "/p/abc/", "/stories/someone/"])(
    "lets everything else through: %s",
    (path) => {
      const page = runPage(reelsOff);
      expect(page.tap(path).stopped).toBe(false);
      expect(page.sent).toEqual([]);
    },
  );

  it("leaves other sites to the app, which opens them in Safari", () => {
    const page = runPage(reelsOff);
    expect(page.tap("https://example.com/reel/abc/").stopped).toBe(false);
  });

  it("agrees with the app's own check, switch by switch", () => {
    const paths = [
      "/",
      "/reel/abc/",
      "/REEL/abc/",
      "/reels/",
      "/reelsomething/",
      "/someone/",
      "/someone/reel/abc/",
      "/someone/reels/",
      "/explore/",
      "/explore/search/",
      "/direct/inbox/",
      "/direct/t/123/",
      "/accounts/edit/",
    ];
    for (const site of [nothingOff, reelsOff, exploreOff, dmsOnly]) {
      for (const path of paths) {
        const url = `https://www.instagram.com${path}`;
        const page = runPage(site);
        expect([site.blockedLine, path, page.tap(path).stopped]).toEqual([
          site.blockedLine,
          path,
          checkLiteUrl(site, url) === "block",
        ]);
      }
    }
  });

  it("is left alone while a password field is on the page", () => {
    const page = runPage(reelsOff, "/");
    page.page.passwordField = true;
    page.tick();
    expect(page.tap("/reel/abc/").stopped).toBe(false);
    expect(page.sent).toEqual([]);
  });

  it("follows new settings without a reload", () => {
    const page = runPage(nothingOff);
    expect(page.tap("/explore/").stopped).toBe(false);
    page.update(buildLiteUpdate(exploreOff, { reelLimit: 0 }));
    expect(page.tap("/explore/").stopped).toBe(true);
    page.update(buildLiteUpdate(nothingOff, { reelLimit: 0 }));
    expect(page.tap("/explore/").stopped).toBe(false);
  });
});

describe("the page-drawn signal", () => {
  it("is sent once, when the site's interface first shows", () => {
    const page = runPage(reelsOff);
    page.tick();
    expect(page.sent).toEqual([]);
    page.page.drawn = true;
    page.tick();
    page.tick();
    expect(page.sent).toEqual([{ type: "ready" }]);
  });

  it("isn't sent while a password field is on the page", () => {
    const page = runPage(reelsOff, "/");
    page.page.passwordField = true;
    page.page.drawn = true;
    page.tick();
    expect(page.sent).toEqual([]);
  });
});

describe("messages from the page", () => {
  it("reads a stopped tap and the page-drawn signal", () => {
    expect(
      parseLiteMessage(
        JSON.stringify({
          type: "tapBlocked",
          url: "https://www.instagram.com/reels/",
        }),
      ),
    ).toEqual({ type: "tapBlocked", url: "https://www.instagram.com/reels/" });
    expect(parseLiteMessage(JSON.stringify({ type: "ready" }))).toEqual({
      type: "ready",
    });
  });

  it("drops a stopped tap without a usable URL", () => {
    expect(parseLiteMessage(JSON.stringify({ type: "tapBlocked" }))).toBeNull();
    expect(
      parseLiteMessage(
        JSON.stringify({
          type: "tapBlocked",
          url: `https://a.b/${"x".repeat(3000)}`,
        }),
      ),
    ).toBeNull();
  });
});

it("tells the page the keyboard is up with the class the bar copy uses", () => {
  const toggle = jest.fn();
  new Function("document", keyboardScript(true))({
    documentElement: { classList: { toggle } },
  });
  new Function("document", keyboardScript(false))({
    documentElement: { classList: { toggle } },
  });
  expect(toggle.mock.calls).toEqual([
    ["refund-lite-typing", true],
    ["refund-lite-typing", false],
  ]);
});

/** Just enough of a DOM node for the feed checks. */
class Node {
  parentElement: Node | null = null;
  children: Node[] = [];
  attributes = new Map<string, string>();
  textRead = 0;
  constructor(
    readonly tag: string,
    readonly height: number,
    private text = "",
    readonly role = "",
  ) {}
  add(...kids: Node[]) {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
  get textContent() {
    this.textRead += 1;
    return this.text;
  }
  get childElementCount() {
    return this.children.length;
  }
  get nextElementSibling(): Node | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getBoundingClientRect() {
    return { top: 100, height: this.height };
  }
  closest(selector: string): Node | null {
    const blocked = selector.includes("article");
    for (let node: Node | null = this; node; node = node.parentElement) {
      if (
        blocked &&
        (["article", "a", "button"].includes(node.tag) ||
          node.role === "button")
      )
        return node;
    }
    return null;
  }
  all(): Node[] {
    return this.children.flatMap((kid) => [kid, ...kid.all()]);
  }
}

/**
 * Home as read on a phone: a tall list of feed items, one holding the
 * "Suggested posts" heading (a short row above a caught-up message), then
 * suggestions. Plus a caption, a link and a story button with the same words.
 */
function runFeed(site: LiteSite, heading = "Suggested posts", path = "/") {
  const leaf = (text: string) => new Node("span", 11, text);
  const caption = leaf("Suggested posts");
  const linked = leaf("Suggested posts");
  const story = leaf("Suggested posts");
  const label = leaf(heading);
  const row = new Node("div", 36).add(new Node("div", 35).add(label));
  const headingItem = new Node("div", 250).add(new Node("div", 214), row);
  const ownPost = new Node("div", 600).add(
    new Node("article", 600).add(caption),
    new Node("a", 20).add(linked),
    new Node("div", 90, "", "button").add(story),
  );
  const after = [new Node("div", 600), new Node("div", 600)];
  const list = new Node("div", 19000).add(ownPost, headingItem, ...after);
  const spinner = new Node("div", 88);
  const main = new Node("main", 19200).add(
    new Node("div", 19100).add(new Node("div", 19000).add(list), spinner),
  );
  const nodes = main.all();
  const scrollBy = jest.fn();
  const fakeWindow: Record<string, unknown> = {
    innerWidth: 390,
    innerHeight: 763,
    ReactNativeWebView: { postMessage: () => {} },
    addEventListener: () => {},
    scrollBy,
  };
  const fakeDocument = {
    hidden: false,
    body: null,
    head: { appendChild: () => {}, removeChild: () => {} },
    documentElement: { classList: { add() {}, remove() {}, toggle() {} } },
    createElement: () => ({ textContent: "", parentNode: null }),
    querySelector: (selector: string) => (selector === "main" ? main : null),
    querySelectorAll: (selector: string) =>
      selector.includes("data-refund-hidden-post")
        ? nodes.filter(
            (n) =>
              n.attributes.has("data-refund-hidden-post") ||
              n.attributes.has("data-refund-suggested-from"),
          )
        : [],
    getElementsByTagName: () => [],
    addEventListener: () => {},
  };
  // The feed query, answered by the fake main.
  (main as unknown as { querySelectorAll: () => Node[] }).querySelectorAll =
    () => nodes.filter((n) => n.tag === "span");
  let tick = () => {};
  new Function(
    "window",
    "document",
    "location",
    "history",
    "setInterval",
    "setTimeout",
    buildLiteInjection(site, { reelLimit: 0 }),
  )(
    fakeWindow,
    fakeDocument,
    {
      pathname: path,
      search: "",
      hostname: "www.instagram.com",
      href: "https://www.instagram.com" + path,
    },
    { pushState: () => {}, replaceState: () => {} },
    (callback: () => void) => {
      tick = callback;
    },
    () => 0,
  );
  const hidden = (node: Node) => node.attributes.has("data-refund-hidden-post");
  return {
    tick: () => tick(),
    update: (script: string) => new Function("window", script)(fakeWindow),
    hidden,
    parts: {
      ownPost,
      row,
      headingItem,
      after,
      spinner,
      caption,
      linked,
      story,
    },
  };
}

describe("Hide suggested posts", () => {
  it("is on unless switched off", () => {
    const block = instagram.optionalBlocks!.find(
      (b) => b.id === "instagram-hide-suggested",
    )!;
    expect(block.defaultOn).toBe(true);
  });

  it("leaves Home as it is, so stories stay", () => {
    expect(suggestedOff.linkRewrites).toEqual([]);
    expect(runPage(suggestedOff).tap("/").stopped).toBe(false);
  });

  it("hides the heading and every item after it, and the spinner", () => {
    const feed = runFeed(suggestedOff);
    feed.tick();
    const { ownPost, row, headingItem, after, spinner } = feed.parts;
    expect(feed.hidden(row)).toBe(true);
    expect(after.map(feed.hidden)).toEqual([true, true]);
    expect(feed.hidden(spinner)).toBe(true);
    // Your own post above the heading, and the caught-up message, stay.
    expect(feed.hidden(ownPost)).toBe(false);
    expect(feed.hidden(headingItem)).toBe(false);
    expect(headingItem.attributes.has("data-refund-suggested-from")).toBe(true);
  });

  it("never reads text inside a post, a link or a button", () => {
    const feed = runFeed(suggestedOff);
    feed.tick();
    const { caption, linked, story } = feed.parts;
    expect([caption, linked, story].map((n) => n.textRead)).toEqual([0, 0, 0]);
  });

  it('leaves a mid-feed "Suggested for you" row and the posts after it', () => {
    const feed = runFeed(suggestedOff, "Suggested for you");
    feed.tick();
    expect(feed.parts.after.map(feed.hidden)).toEqual([false, false]);
  });

  it("only works on Home", () => {
    const feed = runFeed(suggestedOff, "Suggested posts", "/someone/");
    feed.tick();
    expect(feed.hidden(feed.parts.row)).toBe(false);
  });

  it("does nothing while switched off, and brings posts back when switched off", () => {
    const off = runFeed(nothingOff);
    off.tick();
    expect(off.hidden(off.parts.row)).toBe(false);

    const feed = runFeed(suggestedOff);
    feed.tick();
    feed.update(buildLiteUpdate(nothingOff, { reelLimit: 0 }));
    expect(feed.parts.after.map(feed.hidden)).toEqual([false, false]);
    expect(
      feed.parts.headingItem.attributes.has("data-refund-suggested-from"),
    ).toBe(false);
  });
});

describe("Block Explore keeps search", () => {
  it.each([
    ["/explore/", "block"],
    ["/explore", "block"],
    ["/explore/search/", "allow"],
    ["/explore/tags/cats/", "block"],
    ["/explore/locations/123/", "block"],
    ["/explore/search/keyword/?q=cats", "block"],
  ])("%s: %s", (path, verdict) => {
    expect(checkLiteUrl(exploreOff, `https://www.instagram.com${path}`)).toBe(
      verdict,
    );
  });

  it("no longer hides the search button", () => {
    expect(exploreOff.hideSelectors).toEqual(nothingOff.hideSelectors);
  });

  it("sends a tap on Search to the search page instead of the grid", () => {
    const page = runPage(exploreOff);
    expect(page.tap("/explore/").stopped).toBe(true);
    expect(page.moves()).toEqual(["/explore/search/"]);
    expect(page.sent.filter((m) => m.type === "tapBlocked")).toEqual([]);
  });

  it("stops a tap on a hashtag", () => {
    const page = runPage(exploreOff);
    expect(page.tap("/explore/tags/cats/").stopped).toBe(true);
    expect(page.sent).toEqual([
      {
        type: "tapBlocked",
        url: "https://www.instagram.com/explore/tags/cats/",
      },
    ]);
  });
});

describe("the blocked card's line", () => {
  const on = ["instagram-reels", "instagram-explore"];
  it.each([
    ["/explore/tags/cats/", "Explore is switched off here."],
    ["/reel/abc/", "Reels are switched off here."],
    ["/someone/reels/", "Reels are switched off here."],
  ])("names the switch that blocked %s", (path, line) => {
    expect(
      blockedLineFor(instagram, on, `https://www.instagram.com${path}`),
    ).toBe(line);
  });

  it("says messages only in DMs only", () => {
    expect(
      blockedLineFor(
        instagram,
        ["instagram-dms-only"],
        "https://www.instagram.com/someone/",
      ),
    ).toBe("Only messages are open here.");
  });

  it("falls back to the site's own line", () => {
    expect(
      blockedLineFor(instagram, [], "https://www.instagram.com/someone/"),
    ).toBe(instagram.blockedLine);
  });
});

describe("closing the keyboard", () => {
  function chat() {
    const listeners: Record<string, Listener[]> = {};
    const blur = jest.fn();
    const fakeDocument = {
      hidden: false,
      body: null,
      head: { appendChild: () => {}, removeChild: () => {} },
      activeElement: { blur },
      documentElement: {
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains: (name: string) => name === "refund-lite-typing",
        },
      },
      createElement: () => ({ textContent: "", parentNode: null }),
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementsByTagName: () => [],
      addEventListener: (name: string, listener: Listener) => {
        (listeners[name] ??= []).push(listener);
      },
    };
    new Function(
      "window",
      "document",
      "location",
      "history",
      "setInterval",
      "setTimeout",
      buildLiteInjection(instagram, { reelLimit: 0 }),
    )(
      {
        ReactNativeWebView: { postMessage: () => {} },
        addEventListener: () => {},
      },
      fakeDocument,
      {
        pathname: "/direct/t/1/",
        search: "",
        hostname: "www.instagram.com",
        href: "",
      },
      { pushState: () => {}, replaceState: () => {} },
      () => {},
      () => 0,
    );
    const fire = (name: string, event: unknown) =>
      (listeners[name] ?? []).forEach((listener) => listener(event));
    const touch = (y: number) => ({ touches: [{ clientY: y }] });
    return {
      blur,
      gesture(target: unknown, fromY: number, toY: number) {
        fire("touchstart", { ...touch(fromY), target });
        fire("touchmove", touch(toY));
        fire("touchend", {});
      },
    };
  }
  const message = { closest: () => null };
  const textBox = { closest: () => ({}) };

  it("closes on a tap on the messages", () => {
    const page = chat();
    page.gesture(message, 400, 402);
    expect(page.blur).toHaveBeenCalledTimes(1);
  });

  it("closes on a swipe down", () => {
    const page = chat();
    page.gesture(textBox, 400, 460);
    expect(page.blur).toHaveBeenCalledTimes(1);
  });

  it("stays open for a tap on the text box, or a scroll up", () => {
    const page = chat();
    page.gesture(textBox, 400, 401);
    page.gesture(message, 400, 300);
    expect(page.blur).not.toHaveBeenCalled();
  });
});
