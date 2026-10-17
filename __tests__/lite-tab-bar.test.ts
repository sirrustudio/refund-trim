/**
 * The copy of Instagram's bottom bar on the chat list. It holds your profile
 * photo and username, so none of it may reach the app.
 */
import { buildLiteInjection } from "@/utils/lite-inject";
import {
  applyLiteBlocks,
  findLiteSite,
  type LiteSite,
} from "@/utils/lite-sites";

const instagram = findLiteSite("instagram")!;
const { barCopy: _unused, ...withoutCopy } = instagram;
const noCopySite: LiteSite = withoutCopy;

function count(text: string, word: string): number {
  return text.split(word).length - 1;
}

/** A bar as the script saves it after seeing Instagram's own. */
const SAVED_BAR = {
  order: ["/", "/explore/", "/direct/inbox/", "/someone/"],
  items: {
    "/": {
      svg: '<svg viewBox="0 0 24 24"><path d="M1 1"></path></svg>',
      plain: true,
      label: "Home",
    },
    "/explore/": {
      svg: '<svg viewBox="0 0 24 24"><path d="M2 2"></path></svg>',
      plain: true,
      label: "Search",
    },
    "/direct/inbox/": {
      svg: '<svg viewBox="0 0 24 24"><path d="M3 3"></path></svg>',
      plain: true,
      label: "Messages",
    },
    "/someone/": {
      img: "https://cdn.example/photo.jpg",
      label: "someone's profile picture",
    },
  },
};

/** Just enough of a DOM element for the bar copy. */
class FakeElement {
  readonly tagName: string;
  id = "";
  className = "";
  innerHTML = "";
  src = "";
  alt = "";
  isRoot = false;
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  private attributes = new Map<string, string>();
  private classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get isConnected(): boolean {
    return this.isRoot || (this.parentNode?.isConnected ?? false);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
  }

  contains(node: FakeElement): boolean {
    return node === this || this.children.some((c) => c.contains(node));
  }

  // Tag-name selectors only, which is all the copy uses.
  querySelectorAll(tag: string): FakeElement[] {
    return this.children.flatMap((c) => [
      ...(c.tagName === tag.toUpperCase() ? [c] : []),
      ...c.querySelectorAll(tag),
    ]);
  }

  addEventListener() {}
}

/** A text field or dialog at the given height on an 844px screen. */
function overlay(role: string, top: number, bottom: number) {
  const el = Object.assign(new FakeElement("div"), {
    getBoundingClientRect: () => ({ top, bottom, height: bottom - top }),
  });
  el.setAttribute("role", role);
  return el;
}

/** Runs the real script on a fake Instagram page at `path` that has a saved bar. */
function openPage(path: string) {
  const html = new FakeElement("html");
  html.isRoot = true;
  const head = html.appendChild(new FakeElement("head"));
  const body = html.appendChild(new FakeElement("body"));
  // The chat list's new-message link. Your own note replaces the list,
  // removing it.
  const listLink = Object.assign(new FakeElement("a"), {
    getClientRects: () => [{}],
  });
  const state = { noteOpen: false, overlays: [] as FakeElement[] };
  const storage = new Map([["refundLiteBar", JSON.stringify(SAVED_BAR)]]);
  const keysRead: string[] = [];
  const sent: string[] = [];
  const listeners: Record<string, () => void> = {};

  const document = {
    hidden: false,
    documentElement: html,
    head,
    body,
    createElement: (tag: string) => new FakeElement(tag),
    querySelector: (selector: string) =>
      selector === instagram.barCopy!.listAnchor && !state.noteOpen
        ? listLink
        : null,
    // Instagram leaves its own bar off the chat list, so only the text
    // fields and dialogs lookup finds anything.
    querySelectorAll: (selector: string) =>
      selector.includes("textbox") ? state.overlays : [],
    getElementsByTagName: () => [],
    elementFromPoint: () => null,
    addEventListener: (name: string, listener: () => void) => {
      listeners[name] = listener;
    },
  };
  const window = {
    innerWidth: 390,
    innerHeight: 844,
    ReactNativeWebView: {
      postMessage: (message: string) => sent.push(message),
    },
    addEventListener: () => {},
    visualViewport: { height: 844, addEventListener: () => {} },
  };
  const localStorage = {
    getItem: (key: string) => {
      keysRead.push(key);
      return storage.get(key) ?? null;
    },
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  const location = { pathname: path, href: `https://www.instagram.com${path}` };
  const history = { pushState: () => {}, replaceState: () => {} };
  const getComputedStyle = () => ({ position: "static", backgroundColor: "" });

  const script = buildLiteInjection(instagram, { reelLimit: 0 });
  new Function(
    "window",
    "document",
    "location",
    "history",
    "localStorage",
    "getComputedStyle",
    script,
  )(window, document, location, history, localStorage, getComputedStyle);

  const tap = () => listeners.click?.();
  return {
    sent,
    keysRead,
    bar: () => body.children.find((c) => c.id === "refund-lite-bar"),
    openNote: () => {
      state.noteOpen = true;
      tap();
    },
    closeNote: () => {
      state.noteOpen = false;
      tap();
    },
    show: (...overlays: FakeElement[]) => {
      state.overlays = overlays;
      tap();
    },
  };
}

describe("on a fake chat list", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("draws the saved bar, in the site's order, with the inbox marked", () => {
    const page = openPage("/direct/inbox/");
    jest.advanceTimersByTime(2000);
    const links = page.bar()?.querySelectorAll("a") ?? [];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(SAVED_BAR.order);
    const marked = links.filter((a) => a.classList.contains("refund-here"));
    expect(marked.map((a) => a.getAttribute("href"))).toEqual([
      "/direct/inbox/",
    ]);
  });

  it("reads only its own storage entry and sends the app nothing", () => {
    const page = openPage("/direct/inbox/");
    jest.advanceTimersByTime(2000);
    expect(page.bar()).toBeDefined();
    expect(new Set(page.keysRead)).toEqual(new Set(["refundLiteBar"]));
    expect(page.sent).toEqual([]);
  });

  it("hides while your own note replaces the list, and comes back after", () => {
    const page = openPage("/direct/inbox/");
    jest.advanceTimersByTime(2000);
    page.openNote();
    jest.advanceTimersByTime(200);
    expect(page.bar()).toBeUndefined();
    page.closeNote();
    jest.advanceTimersByTime(200);
    expect(page.bar()).toBeDefined();
  });

  it("hides under a friend's note, whose reply box opens over the list", () => {
    const page = openPage("/direct/inbox/");
    jest.advanceTimersByTime(2000);
    page.show(overlay("textbox", 790, 830));
    jest.advanceTimersByTime(200);
    expect(page.bar()).toBeUndefined();
    page.show();
    jest.advanceTimersByTime(200);
    expect(page.bar()).toBeDefined();
  });

  it("hides while a dialog is open", () => {
    const page = openPage("/direct/inbox/");
    page.show(overlay("dialog", 200, 600));
    jest.advanceTimersByTime(2000);
    expect(page.bar()).toBeUndefined();
  });

  it("stays up beside a text field clear of it, like the search box", () => {
    const page = openPage("/direct/inbox/");
    page.show(overlay("textbox", 44, 84));
    jest.advanceTimersByTime(2000);
    expect(page.bar()).toBeDefined();
  });

  it.each(["/direct/t/123/", "/direct/requests/"])(
    "stays off on %s, which gets the full screen",
    (path) => {
      const page = openPage(path);
      jest.advanceTimersByTime(2000);
      expect(page.bar()).toBeUndefined();
    },
  );
});

it("styles the copy only for a site that has one", () => {
  expect(buildLiteInjection(instagram, { reelLimit: 0 })).toContain(
    "#refund-lite-bar{position:fixed",
  );
  expect(buildLiteInjection(noCopySite, { reelLimit: 0 })).not.toContain(
    "#refund-lite-bar{position:fixed",
  );
});

it("adds no message of its own to the script", () => {
  // The same postMessage calls either way: the URL, the edge colours and the
  // reel limit.
  const withCopy = buildLiteInjection(instagram, { reelLimit: 2 });
  const withoutIt = buildLiteInjection(noCopySite, { reelLimit: 2 });
  expect(count(withCopy, "postMessage")).toBe(count(withoutIt, "postMessage"));
});

it("builds a page script that parses", () => {
  // The script is a string, so a syntax error would only show on a phone,
  // where none of it would run.
  for (const site of [instagram, noCopySite]) {
    const script = buildLiteInjection(site, { reelLimit: 2 });
    expect(() => new Function(script)).not.toThrow();
  }
});

it("has a switch: on by default, and off means no copy", () => {
  const block = instagram.optionalBlocks!.find((b) => b.turnsOnBarCopy)!;
  expect(block.defaultOn).toBe(true);
  expect(applyLiteBlocks(instagram, [block.id]).barCopy).toBeDefined();
  expect(applyLiteBlocks(instagram, []).barCopy).toBeUndefined();
});

it("leaves the copy out in DMs only, where its buttons would lead nowhere", () => {
  expect(
    applyLiteBlocks(instagram, ["instagram-dm-bar", "instagram-dms-only"])
      .barCopy,
  ).toBeUndefined();
});
