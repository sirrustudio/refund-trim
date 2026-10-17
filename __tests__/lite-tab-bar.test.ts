/**
 * The copy of Instagram's own bottom bar on the message pages (Oct 16).
 * Instagram's website leaves its bar out there; the page script shows a copy
 * of it, rebuilt inside the page. Nothing of it may ever reach Refund: the
 * copy holds your photo and username.
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

it("styles the copy only for a site that asks for one", () => {
  expect(buildLiteInjection(instagram, { reelLimit: 0 })).toContain(
    "#refund-lite-bar{position:fixed",
  );
  expect(buildLiteInjection(noCopySite, { reelLimit: 0 })).not.toContain(
    "#refund-lite-bar{position:fixed",
  );
});

it("sends Refund nothing more because of the copy", () => {
  // The copy adds no message of its own: the same ones are sent either way
  // (the address, the edge colours, the reel limit).
  const withCopy = buildLiteInjection(instagram, { reelLimit: 2 });
  const withoutIt = buildLiteInjection(noCopySite, { reelLimit: 2 });
  expect(count(withCopy, "postMessage")).toBe(count(withoutIt, "postMessage"));
});

it("keeps the copy in the page's own storage", () => {
  const script = buildLiteInjection(instagram, { reelLimit: 0 });
  expect(script).toContain("localStorage.setItem(BAR_KEY");
});

it("shows the copy on the chat lists, not inside a chat", () => {
  expect(instagram.barCopy?.copyOnPaths).toEqual([
    "/direct/inbox",
    "/direct/requests",
  ]);
});

it("builds a page script that is valid JavaScript", () => {
  // A slip in the escaping (a regex written inside the script's text) once
  // broke the whole script, so on a phone none of it would have run.
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
    applyLiteBlocks(instagram, ["instagram-dm-bar", "instagram-dms-only"]).barCopy,
  ).toBeUndefined();
});
