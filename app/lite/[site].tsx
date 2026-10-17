import { router, Stack, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Share,
  StyleSheet,
  TurboModuleRegistry,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { LiteBlockedCard } from "@/components/sirru/lite/lite-blocked-card";
import { LiteMenu } from "@/components/sirru/lite/lite-menu";
import { LiteSettingsSheet } from "@/components/sirru/lite/lite-settings-sheet";
import { LiteStatusPanel } from "@/components/sirru/lite/lite-status-panel";
import { T } from "@/constants/tokens";
import { useIsDark } from "@/hooks/use-color-scheme";
import { useLiteIntro } from "@/hooks/use-lite-intro";
import { useLiteSettings } from "@/hooks/use-lite-settings";
import { useSirruFonts } from "@/hooks/use-sirru-fonts";
import { track } from "@/utils/analytics";
import {
  checkLiteUrl,
  isNoScriptUrl,
  isSignedInUrl,
  parseLiteUrl,
  type LiteVerdict,
} from "@/utils/lite-filter";
import {
  buildLiteInjection,
  parseLiteMessage,
  PAUSE_ALL_VIDEOS,
  type LiteRgb,
} from "@/utils/lite-inject";
import {
  enabledBlockIds,
  getSiteLook,
  peekLiteSettings,
  type LiteSettings,
} from "@/utils/lite-settings";
import { applyLiteBlocks, findLiteSite } from "@/utils/lite-sites";

type BlockedState = {
  line: string;
  buttonLabel: string;
  /** The reel limit was hit: the button reloads this chat instead of going home. */
  backToChat?: boolean;
};

/**
 * Loads the web view only if its native half is inside this build.
 *
 * Why not a normal import at the top: `react-native-webview` looks up its
 * native module the moment it is imported, and throws if it's missing (an app
 * built before the package was added). A throw at import breaks this whole
 * route, and Expo Router shows "Unmatched Route". Loading it here, after a
 * safe check, turns that into a calm "update needed" panel instead.
 */
function loadWebView(): typeof WebView | null {
  try {
    // `get` (not `getEnforcing`) returns null instead of throwing.
    if (!TurboModuleRegistry.get("RNCWebViewModule")) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-webview").WebView as typeof WebView;
  } catch {
    return null;
  }
}
const NativeWebView = loadWebView();

/** Until the page reports its own: Instagram's white, or its dark (Oct 14). */
const LIGHT_PAGE: LiteRgb = { r: 255, g: 255, b: 255 };
const DARK_PAGE: LiteRgb = { r: 12, g: 16, b: 20 };

function toCss({ r, g, b }: LiteRgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Dark enough to need a white clock on it (perceived brightness). */
function isDarkRgb({ r, g, b }: LiteRgb): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/**
 * The lite browser: a site's own web page with Reels, Shorts and the like
 * switched off. On this phone only, Refund looks at the ADDRESS to decide
 * allow / block and (reels limit in DMs) at whether a big video is playing. It
 * never reads messages, the login or what you type, and sends none of it.
 */
export default function LiteBrowserScreen() {
  const fontsLoaded = useSirruFonts();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const { site: siteParam } = useLocalSearchParams<{ site?: string }>();
  // The param came from a link, so check it against the known list.
  const baseSite = findLiteSite(siteParam);

  // The switches. `settings` follows the sheet live; `applied` is what the
  // page is actually using. They meet when the sheet closes ("Done"), so the
  // page reloads once instead of after every tap.
  const liteSettings = useLiteSettings();
  // Usually already known (the Trim page loaded it), so the page starts
  // at once.
  const [applied, setApplied] = useState<LiteSettings | null>(() =>
    peekLiteSettings(),
  );
  useEffect(() => {
    if (liteSettings.loaded && applied === null) {
      setApplied(liteSettings.settings);
    }
  }, [liteSettings.loaded, liteSettings.settings, applied]);
  const site = useMemo(
    () =>
      baseSite && applied
        ? applyLiteBlocks(baseSite, enabledBlockIds(applied))
        : null,
    [baseSite, applied],
  );

  const webRef = useRef<WebView>(null);
  const blockedShownRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Changing this remounts the web view: "Try again" after an error.
  const [attempt, setAttempt] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  // Size of the page area, so the menu button knows how far it can be dragged.
  const [webSize, setWebSize] = useState({ width: 0, height: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentUrlRef = useRef<string | null>(null);
  // Gentle stop: `reminderRound` restarts the timer after "Keep going".
  const [reminderShown, setReminderShown] = useState(false);
  const [reminderRound, setReminderRound] = useState(0);
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  // iOS shut the page down: when it last happened, and whether it happened
  // twice in a row (then Refund asks instead of reloading again).
  const lastStopAtRef = useRef(0);
  const [stopped, setStopped] = useState(false);
  // True while the page loading is a login page: no script is handed over.
  const [scriptOff, setScriptOff] = useState(false);
  // The colours at the page's top and bottom edges, reported by the page
  // script, for the strips behind the clock and the home bar.
  const [edgeColors, setEdgeColors] = useState<{
    top: LiteRgb;
    bottom: LiteRgb;
  } | null>(null);
  // First-time help: remembers the first login, which retires the
  // "password goes to Instagram" line on the Trim page, and the first
  // use of the ⋯ button, which retires its bubble.
  const { intro, markDone } = useLiteIntro();
  // One save per visit is enough; every later page would just repeat it.
  const signedInSavedRef = useRef(false);

  // Gentle stop: one pause card after N minutes in this visit.
  const siteLook =
    baseSite && applied ? getSiteLook(applied, baseSite.id) : null;
  const reminderMins = siteLook?.reminderMins ?? 0;
  useEffect(() => {
    if (!reminderMins) return;
    const timer = setTimeout(
      () => setReminderShown(true),
      reminderMins * 60_000,
    );
    return () => clearTimeout(timer);
  }, [reminderMins, reminderRound]);

  // Runs the filter on an address. Returns true when the page may show.
  const handleAddress = useCallback(
    (url: string): LiteVerdict => {
      if (!site) return "block";
      const verdict = checkLiteUrl(site, url);

      if (verdict === "block") {
        // Already showing: don't count one tap twice (both layers can fire).
        if (!blockedShownRef.current) {
          blockedShownRef.current = true;
          track("lite_blocked", { site: site.id });
        }
        setBlocked({ line: site.blockedLine, buttonLabel: site.safeHomeLabel });
        // The card hides the page, but a reel may already be playing its
        // sound behind it.
        webRef.current?.injectJavaScript(PAUSE_ALL_VIDEOS);
      }
      return verdict;
    },
    [site],
  );

  // Layer 1: full page loads. Returning false stops the load.
  function onShouldStartLoad(request: ShouldStartLoadRequest): boolean {
    // Frames inside the page (embeds, ads) aren't the user going somewhere.
    if (request.isTopFrame === false) return true;
    const verdict = handleAddress(request.url);
    // Decided before the page loads, so a login page gets no script at all.
    if (verdict === "allow" && site) {
      setScriptOff(isNoScriptUrl(site, request.url));
    }
    if (verdict === "external") {
      // Only real web links go to Safari; other schemes (like the real
      // Instagram app's own) are not opened.
      const parsed = parseLiteUrl(request.url);
      if (
        parsed &&
        (parsed.protocol === "https" || parsed.protocol === "http")
      ) {
        void Linking.openURL(request.url).catch(() => {});
      }
    }
    return verdict === "allow";
  }

  // Layer 2: the site changed the address without loading a page.
  function onMessage(event: WebViewMessageEvent) {
    const message = parseLiteMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === "nav") {
      handleAddress(message.url);
      return;
    }
    if (message.type === "colors") {
      setEdgeColors({ top: message.top, bottom: message.bottom });
      return;
    }
    // Reel limit hit inside the DMs (counted in the page).
    if (!site || !applied) return;
    if (!blockedShownRef.current) {
      blockedShownRef.current = true;
      track("lite_blocked", { site: site.id });
    }
    // The page paused the reel already; this keeps the next one from starting.
    webRef.current?.injectJavaScript(PAUSE_ALL_VIDEOS);
    const count = applied.dmReelLimit;
    setBlocked({
      line: `That's your ${count} reel${count === 1 ? "" : "s"}.`,
      buttonLabel: "Back to the chat",
      backToChat: true,
    });
  }

  function goSafeHome() {
    if (!site) return;
    setBlocked(null);
    blockedShownRef.current = false;
    // Reel limit: reload this same chat, which closes the reel viewer.
    // Anything else: leave the switched-off page the site already moved to.
    const target = blocked?.backToChat
      ? "window.location.href"
      : JSON.stringify(site.startUrl);
    webRef.current?.injectJavaScript(
      `window.location.replace(${target}); true;`,
    );
  }

  // Home leaves the browser for the Trim page that opened it. If there
  // is nothing to go back to (opened from a link), go to that page itself.
  function leaveToPage() {
    if (router.canGoBack()) router.back();
    else router.replace("/lite");
  }

  function retry() {
    setFailed(false);
    setStopped(false);
    setLoading(true);
    setAttempt((count) => count + 1);
  }

  // iOS shut the page down, usually to free memory while you were in another
  // app. The web view then stays blank or frozen until something reloads it,
  // which used to mean leaving the browser and opening it again. So reload it
  // here, on the same page. A second stop within 30 seconds means reloading
  // isn't helping, so ask instead of going round in a loop.
  function onPageStopped() {
    const now = Date.now();
    const stoppedAgain = now - lastStopAtRef.current < 30_000;
    lastStopAtRef.current = now;
    if (stoppedAgain) {
      setStopped(true);
      return;
    }
    setLoading(true);
    webRef.current?.reload();
  }

  function applySettingsAndClose() {
    setSettingsOpen(false);
    // Only reload if a switch really changed.
    if (JSON.stringify(liteSettings.settings) === JSON.stringify(applied))
      return;
    setApplied(liteSettings.settings);
    setBlocked(null);
    blockedShownRef.current = false;
    setFailed(false);
    setStopped(false);
    setLoading(true);
    setAttempt((count) => count + 1);
  }

  function shareLink() {
    const url = currentUrlRef.current ?? site?.startUrl;
    if (url) void Share.share({ url, message: url }).catch(() => {});
  }

  // The script the page runs (see lite-inject.ts). The web view only reads it
  // when a page loads, so it only needs rebuilding when the switches change;
  // without useMemo it was rebuilt on every address change for no effect.
  const fullInjection = useMemo(
    () =>
      baseSite && site && applied
        ? buildLiteInjection(site, {
            reelLimit: baseSite.dmReelViewer ? applied.dmReelLimit : 0,
          })
        : "",
    [baseSite, site, applied],
  );
  // Login pages get none. Swapping this doesn't reload the page; the web view
  // uses it from the next page load on.
  const injection = scriptOff ? undefined : fullInjection;

  // Unknown site (bad link) or the kill switch is off: nothing to show.
  useEffect(() => {
    if (!baseSite) router.back();
  }, [baseSite]);

  // `site` is null until the saved switches have loaded (a moment).
  if (!fontsLoaded || !baseSite || !site || !applied) return null;

  // Refund's own cream cover is up (loading, no connection, page stopped,
  // blocked, gentle stop): it fills the whole screen, clock and home bar
  // included.
  const coverShown =
    !NativeWebView ||
    loading ||
    failed ||
    stopped ||
    !!blocked ||
    reminderShown;
  // Where the page goes. Instagram leaves no room for the clock or the home
  // bar (Safari never puts a page there), so its top bar sat under the clock
  // (seen Oct 14). So the page sits between them, and the two strips are
  // painted the colour the page has at that edge, which makes it look full
  // screen. Login pages are the exception: the script is off there, so their
  // colour is unknown (a guess left black bands around a white login page in
  // dark mode), and their form starts low enough to go edge to edge.
  const edgeToEdge = scriptOff;
  // First-time bubble by the ⋯ button: once signed in, on a plain page. Login
  // pages, Refund's covers and the settings sheet keep it hidden meanwhile.
  const menuTipShown =
    !!intro &&
    intro.signedInOnce &&
    !intro.menuTipDone &&
    !scriptOff &&
    !coverShown &&
    !settingsOpen;
  const fallback = isDark ? DARK_PAGE : LIGHT_PAGE;
  const topColor = edgeColors?.top ?? fallback;
  const bottomColor = edgeColors?.bottom ?? fallback;
  const pageFrame = edgeToEdge
    ? StyleSheet.absoluteFill
    : {
        ...StyleSheet.absoluteFillObject,
        top: insets.top,
        bottom: insets.bottom,
      };
  // The clock's colour follows what is behind it: the top strip, or on a login
  // page the page itself, which follows Refund's light/dark.
  const statusStyle = coverShown
    ? "auto"
    : (edgeToEdge ? isDark : isDarkRgb(topColor))
      ? "light"
      : "dark";

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={statusStyle} />
      <View style={styles.body}>
        {NativeWebView && !edgeToEdge ? (
          <>
            <View
              style={[
                styles.strip,
                {
                  top: 0,
                  height: insets.top,
                  backgroundColor: toCss(topColor),
                },
              ]}
            />
            <View
              style={[
                styles.strip,
                {
                  bottom: 0,
                  height: insets.bottom,
                  backgroundColor: toCss(bottomColor),
                },
              ]}
            />
          </>
        ) : null}
        {NativeWebView ? (
          <NativeWebView
            key={attempt}
            ref={webRef}
            // "*" hands EVERY address to our filter. With the default list
            // (http/https only) the library opens anything else itself, so
            // an "instagram://" link from the page launched the real
            // (shielded) Instagram app and a pause screen appeared.
            originWhitelist={["*"]}
            source={{ uri: site.startUrl }}
            // Runs before the page's own code so no address change is missed.
            injectedJavaScriptBeforeContentLoaded={injection}
            onShouldStartLoadWithRequest={onShouldStartLoad}
            onMessage={onMessage}
            onNavigationStateChange={(nav) => {
              setCanGoBack(nav.canGoBack);
              setCanGoForward(nav.canGoForward);
              currentUrlRef.current = nav.url;
              // A page that only opens when signed in: the first login has
              // happened, so the login help (here and on the page) retires.
              if (
                !signedInSavedRef.current &&
                !nav.loading &&
                isSignedInUrl(site, nav.url)
              ) {
                signedInSavedRef.current = true;
                if (!intro?.signedInOnce) markDone("signedInOnce");
              }
              // Off a login page without a new page load (or the swap lost
              // the race): put the script in now. It skips itself if it's
              // already on the page.
              if (
                scriptOff &&
                !nav.loading &&
                fullInjection &&
                !isNoScriptUrl(site, nav.url)
              ) {
                setScriptOff(false);
                webRef.current?.injectJavaScript(fullInjection);
              }
            }}
            // Lift the cover once the page is mostly there instead of waiting
            // for every last image; it is cream, so nothing flashes white.
            onLoadProgress={(event) => {
              if (event.nativeEvent.progress >= 0.75) setLoading(false);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={() => setFailed(true)}
            onContentProcessDidTerminate={onPageStopped}
            // Videos (a clip a friend sent) play in the page
            // instead of jumping to full screen.
            allowsInlineMediaPlayback
            // Dev builds only: the Mac's Safari (Develop menu) can look inside
            // the page, e.g. to check Lite's script is off on the login form.
            // Always off in App Store and TestFlight builds.
            webviewDebuggingEnabled={__DEV__}
            // No long-press link preview: it loads the page in the
            // background (extra work) and would preview a blocked Reels link.
            allowsLinkPreview={false}
            // Swipe from the left edge goes back INSIDE the page. On the first
            // page it is switched off, so the same swipe belongs to the
            // screen instead and leaves Lite (there is no top bar any more).
            allowsBackForwardNavigationGestures={canGoBack}
            // Cookies stay on this phone, like Safari. Refund never reads them.
            // The room for the clock and home bar is made above (pageFrame),
            // so iOS mustn't add it again.
            contentInsetAdjustmentBehavior="never"
            style={pageFrame}
          />
        ) : null}

        {/* Refund's own layer: covers and the ⋯ button stay clear of the
            clock and home bar. Touches pass through to the page except on
            what's drawn here. */}
        <SafeAreaView
          edges={["top", "left", "right", "bottom"]}
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, coverShown && styles.cover]}
        >
          <View
            style={styles.layer}
            pointerEvents="box-none"
            onLayout={(event) => setWebSize(event.nativeEvent.layout)}
          >
            {!NativeWebView ? (
              <LiteStatusPanel
                label="UPDATE NEEDED"
                line={`This version of Refund can't open ${site.label} here yet. Update the app and try again.`}
              />
            ) : null}

            {NativeWebView && loading && !failed && !stopped ? (
              <LiteStatusPanel label={`OPENING ${site.label.toUpperCase()}`} />
            ) : null}
            {failed ? (
              <LiteStatusPanel
                label="NO CONNECTION"
                line={`Couldn't reach ${site.label}.`}
                buttonLabel="Try again"
                onPress={retry}
              />
            ) : null}
            {stopped && !failed ? (
              <LiteStatusPanel
                label="PAGE STOPPED"
                line="The page closed on its own."
                buttonLabel="Open again"
                onPress={retry}
              />
            ) : null}
            {blocked ? (
              <LiteBlockedCard
                line={blocked.line}
                buttonLabel={blocked.buttonLabel}
                onBack={goSafeHome}
              />
            ) : null}

            {reminderShown ? (
              <LiteStatusPanel
                label={`${reminderMins} MINUTES IN`}
                line="A gentle stop. Use the menu's home button when you're done."
                buttonLabel="Keep going"
                onPress={() => {
                  setReminderShown(false);
                  setReminderRound((round) => round + 1);
                }}
              />
            ) : null}

            {/* The only chrome left: a small draggable button that opens a
              toolbar. Drawn last so it sits on top of everything. */}
            <LiteMenu
              bounds={webSize}
              siteLabel={site.label}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onBack={() => webRef.current?.goBack()}
              onForward={() => webRef.current?.goForward()}
              onHome={leaveToPage}
              onReload={() => webRef.current?.reload()}
              onShare={shareLink}
              onSettings={() => setSettingsOpen(true)}
              showTip={menuTipShown}
              // Saved once: a tap before the bubble ever showed (on the login
              // page, say) counts too, since the button's been found.
              onTipDone={() => {
                if (intro && !intro.menuTipDone) markDone("menuTipDone");
              }}
              // Names under the toolbar's icons, the first time it opens.
              showNames={!!intro && !intro.menuNamesDone}
              onNamesDone={() => {
                if (intro && !intro.menuNamesDone) markDone("menuNamesDone");
              }}
            />
          </View>
        </SafeAreaView>
      </View>

      <LiteSettingsSheet
        visible={settingsOpen}
        site={baseSite}
        api={liteSettings}
        onDone={applySettingsAndClose}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Cream under the page, so a page still loading never flashes white.
  body: { flex: 1, backgroundColor: T.cream },
  layer: { flex: 1 },
  // Behind the clock and the home bar, painted the page's edge colour.
  strip: { position: "absolute", left: 0, right: 0 },
  // Behind a cover, the clock and home-bar strips are cream too.
  cover: { backgroundColor: T.cream },
});
