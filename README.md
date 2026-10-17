# Trim

The code behind **Trim**, a page in the iPhone app [Refund: Screen Time](https://apps.apple.com/ca/app/refund-screen-time/id6791383965). Trim opens Instagram's website inside Refund with Reels switched off, so you can keep your DMs, stories and profile without the endless video feed.

Refund is not affiliated with or endorsed by Instagram or Meta.

Trim was first called Reel-free, and its working name was Lite, so the files are named `lite-...`.

## Why this is public

Trim is a browser inside Refund, and you log in to Instagram in it. You shouldn't have to take our word for what it does there. This is a read-only copy of the files that decide it, so you can check.

Refund itself is closed source. The pieces around these files (buttons, fonts, the rest of the app) aren't included, so this isn't something you can build into an app. It is something you can read and test.

## What runs on Instagram's page

One script: [`utils/lite-inject.ts`](utils/lite-inject.ts), about 620 lines. Refund hands it to the page as the page starts loading. It does seven things:

1. **Hides buttons** that lead to the parts you've switched off (Reels is on by default, Explore is optional), plus Instagram's "Open app" button and its "Use the app" bar, with a style rule. The list is in [`utils/lite-sites.ts`](utils/lite-sites.ts). Another style rule swaps the two icons at the top of your profile, so the settings gear sits top right, as in the Instagram app.
2. **Reports address changes to Refund.** Instagram often changes its address without loading a new page, so the script tells Refund each new address. Refund then decides whether to show the page or a "switched off here" card.
3. **Pauses videos** that start playing behind that card.
4. **Counts reels played in messages**, for the "Reels allowed in DMs" limit. When you pass the limit it sends Refund a short message saying so. To tell reels apart it remembers each video's source address in the page's memory only. That is never sent.
5. **Reports the page's edge colours.** Instagram leaves no room for the iPhone's clock or home bar, so Refund keeps the page between them and paints those two strips to match the page. The script sends the background colour at the page's top and bottom edge, only when it changes. Refund accepts nothing but `rgb()` numbers.
6. **Switches itself off** on any page that has a password box, within a second or the moment you tap the box.
7. **Shows Instagram's own bottom bar on your chat list.** Instagram's website leaves its bottom bar off the message pages. With "Bar in DMs" on (the default), the script remembers the last bar it saw on another page: each button's address (like `/explore/`), its icon drawing and label, and your profile photo's address and its label (Instagram's own text, which names your account). It keeps this in the page's own storage on your phone (`localStorage`, one entry called `refundLiteBar`), which belongs to Instagram's site, and draws a copy of the bar on the chat list. None of it is sent to Refund.

## What it never does

- It makes no network requests of its own. (The copy of the bottom bar shows your profile photo from the same Instagram address the real bar uses.) The only things it sends are three kinds of message to the Refund app on the same phone: the page's address, "reel limit reached", and the two edge colours. Search the file for `postMessage`: there are three.
- It doesn't read what you type. It checks only whether a password box exists, never what is in it.
- It doesn't read your messages, posts or cookies. The only stored data it touches is its own `refundLiteBar` entry. The only things it reads from the page are its address, whether it has a password box, the background colour at its top and bottom edge, the size, position and source address of videos, and the buttons of Instagram's bottom bar (addresses, icon drawings, labels and your photo's address).

This search should print five lines, all from the bottom bar copy: two copy an icon's drawing attributes (`attr.value`), two read and write its `refundLiteBar` entry, and one draws an icon that was cleaned to drawing only (`innerHTML`):

```
grep -nE "\.value|keydown|keyup|keypress|cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|innerText|innerHTML|clipboard" utils/lite-inject.ts
```

## Login pages

Your password goes to Instagram, not Refund. Three things back that up:

- Refund doesn't give the script to Instagram's login, two-factor or challenge pages (`noScriptPaths` in [`utils/lite-sites.ts`](utils/lite-sites.ts)).
- If the script lands on one anyway, it stops on its first lines.
- Instagram also shows its login form at its home address, so the script switches itself off on any page with a password box.

`npm test` runs the real script against a pretend page to check this.

## What Refund does with it

- **Checked on your phone:** the address of each page is compared with the rules in [`utils/lite-filter.ts`](utils/lite-filter.ts) to decide whether to show it. It isn't saved or sent.
- **Saved on your phone:** your switch choices ([`utils/lite-settings.ts`](utils/lite-settings.ts)) and a few yes-or-no notes so first-time tips show once ([`utils/lite-intro.ts`](utils/lite-intro.ts)). The bottom bar copy lives in Instagram's page storage, not Refund's (point 7 above). Instagram's own login and cookies are kept by iOS's web view, the way a browser does. Refund never reads them.
- **Sent anywhere:** two anonymous counts for this feature, `lite_opened` and `lite_blocked`. Each carries only the site's name (`instagram`), never an address. Like every Refund event, they also carry the anonymous details listed in the [privacy policy](https://sirrustudio.com/refund/privacy/). `lite_blocked` is sent from [`app/lite/[site].tsx`](app/lite/%5Bsite%5D.tsx). `lite_opened` is sent when you tap Open Instagram on the Trim page; that page is only layout, so it isn't in this copy. The analytics code itself isn't part of this copy either; the privacy policy lists every event.
- **Only when you tap:** a link to another website opens in Safari, and "Share link" opens iPhone's share sheet with the current address.

## Run the tests

You need Node 18 or newer.

```
npm install
npm test
```

## What this can't prove

Refund is closed source, so this copy can't prove that the App Store build matches it. We update it whenever Trim's code changes. What you can do yourself is read the script and watch what Refund contacts: on your iPhone, open Settings, then Privacy & Security, then App Privacy Report. Instagram's own domains will show up there, since that is where the page comes from.

## License and contact

MIT, see [LICENSE](LICENSE). It covers the code, not the names Refund or Sirru. Questions, or something looks wrong: [sirrustudio.com/refund/support](https://sirrustudio.com/refund/support/)
