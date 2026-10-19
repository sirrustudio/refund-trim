import { router, Stack, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
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
import { useKeyboardOverlap } from "@/hooks/use-keyboard-overlap";
import { useLiteIntro } from "@/hooks/use-lite-intro";
import { useLiteSettings } from "@/hooks/use-lite-settings";
import { useSirruFonts } from "@/hooks/use-sirru-fonts";
import { track } from "@/utils/analytics";
import {
  blockedLineFor,
  checkLiteUrl,
  isNoScriptUrl,
  isSignedInUrl,
  parseLiteUrl,
  type LiteVerdict,
} from "@/utils/lite-filter";
import {
  buildLiteInjection,
  buildLiteUpdate,
  keyboardScript,
  parseLiteMessage,
  PAUSE_ALL_VIDEOS,
  RELOAD_UNLESS_TYPING,
  RESUME_VIDEOS,
  type LiteRgb,
} from "@/utils/lite-inject";
import {
  enabledBlockIds,
  getSiteLook,
  peekLiteSettings,
  type LiteSettings,
} from "@/utils/lite-settings";
import { applyLiteBlocks, findLiteSite } from "@/utils/lite-sites";

/**
 * How the blocked card's button gets out:
 * - stay: the page never left (a stopped tap), so the card just closes
 * - back: the page moved to the address in place, so it steps back
 * - home: anything else (a full page load, new settings): the start page loads
 * - chat: the reel limit; reloading the chat closes the reel viewer
 */
type BlockedExit = "stay" | "back" | "home" | "chat";

type BlockedState = {
  line: string;
  buttonLabel: string;
  exit: BlockedExit;
};

/** How an address reached handleAddress, which picks the card's way out. */
type Arrival = "tap" | "load" | "move" | "recheck";

/**
 * A plain import throws in builds made before react-native-webview was
 * added, which breaks the whole route. Checking for the native module first
 * lets the screen show an "update needed" panel instead.
 */
function loadWebView(): typeof WebView | null {
  try {
    if (!TurboModuleRegistry.get("RNCWebViewModule")) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-webview").WebView as typeof WebView;
  } catch {
    return null;
  }
}
const NativeWebView = loadWebView();

/**
 * Time in the background after which the page is refreshed on return. Long
 * enough that a quick trip out never shows Instagram's loading screen.
 */
const REFRESH_AFTER_MS = 5 * 60_000;

/**
 * Longest the loading cover waits, once the page has loaded, for the script
 * to say the site's interface is drawn. Login pages have no script to say so.
 */
const READY_WAIT_MS = 3000;

/** The loading cover's fade once the page is drawn. */
const COVER_FADE_MS = 220;

/** Time for a step back to land before checking it left the blocked page. */
const BACK_CHECK_MS = 700;

/** Edge colours until the page reports its own: Instagram's light and dark backgrounds. */
const LIGHT_PAGE: LiteRgb = { r: 255, g: 255, b: 255 };
const DARK_PAGE: LiteRgb = { r: 12, g: 16, b: 20 };

function toCss({ r, g, b }: LiteRgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Dark enough to need light status bar content (perceived brightness). */
function isDarkRgb({ r, g, b }: LiteRgb): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

function loadPageScript(url: string): string {
  return `window.location.replace(${JSON.stringify(url)}); true;`;
}

/**
 * The Lite browser: the site's own web page with the switched-off sections
 * blocked. It checks URLs on the phone and never reads messages, logins or
 * what you type.
 */
export default function LiteBrowserScreen() {
  const fontsLoaded = useSirruFonts();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const keyboardOverlap = useKeyboardOverlap();
  const { site: siteParam } = useLocalSearchParams<{ site?: string }>();
  const baseSite = findLiteSite(siteParam);

  // `settings` follows the sheet live; `applied` is what the page uses. They
  // sync when the sheet closes, so the page updates once, not on every tap.
  const liteSettings = useLiteSettings();
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
  const reelLimit = baseSite?.dmReelViewer && applied ? applied.dmReelLimit : 0;

  const webRef = useRef<WebView>(null);
  const blockedShownRef = useRef(false);

  // From opening the page until the site's own interface is drawn: the cover
  // stays up through the site's loading screens, then fades.
  const [opening, setOpening] = useState(true);
  // The page itself has loaded (images aside).
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Changing this remounts the web view ("Try again").
  const [attempt, setAttempt] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  // Bounds for dragging the menu button.
  const [webSize, setWebSize] = useState({ width: 0, height: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentUrlRef = useRef<string | null>(null);
  // Gentle stop: bumping reminderRound restarts the timer after "Keep going".
  const [reminderShown, setReminderShown] = useState(false);
  const [reminderRound, setReminderRound] = useState(0);
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  const backCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // See onPageStopped.
  const lastStopAtRef = useRef(0);
  const [stopped, setStopped] = useState(false);
  // True on login pages, which get no script.
  const [scriptOff, setScriptOff] = useState(false);
  // Reported by the script, for the safe-area strips.
  const [edgeColors, setEdgeColors] = useState<{
    top: LiteRgb;
    bottom: LiteRgb;
  } | null>(null);
  const { intro, markDone } = useLiteIntro();
  const signedInSavedRef = useRef(false);

  useEffect(
    () => () => {
      if (backCheckRef.current) clearTimeout(backCheckRef.current);
    },
    [],
  );

  // Gentle stop: one card after N minutes in this visit.
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

  // The page stops updating in the background, so new messages and notes
  // only showed after tapping reload. This does it on return instead.
  const backgroundSinceRef = useRef(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        backgroundSinceRef.current = Date.now();
        return;
      }
      if (state !== "active" || !backgroundSinceRef.current) return;
      const awayMs = Date.now() - backgroundSinceRef.current;
      backgroundSinceRef.current = 0;
      // Login pages get no script, and the covers are reloaded their own way.
      if (
        awayMs < REFRESH_AFTER_MS ||
        scriptOff ||
        blocked ||
        failed ||
        stopped
      )
        return;
      webRef.current?.injectJavaScript(RELOAD_UNLESS_TYPING);
    });
    return () => subscription.remove();
  }, [scriptOff, blocked, failed, stopped]);

  // The loading cover comes off when the script says the page is drawn, or
  // after READY_WAIT_MS. Login pages have no script, so they show at once.
  useEffect(() => {
    if (!opening || !loaded) return;
    if (scriptOff) {
      setOpening(false);
      return;
    }
    const timer = setTimeout(() => setOpening(false), READY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [opening, loaded, scriptOff]);

  const coverOpacity = useRef(new Animated.Value(1)).current;
  const [coverGone, setCoverGone] = useState(false);
  useEffect(() => {
    if (opening) {
      coverOpacity.setValue(1);
      setCoverGone(false);
      return;
    }
    const fade = Animated.timing(coverOpacity, {
      toValue: 0,
      duration: COVER_FADE_MS,
      useNativeDriver: true,
    });
    fade.start(({ finished }) => {
      if (finished) setCoverGone(true);
    });
    return () => fade.stop();
  }, [opening, coverOpacity]);

  // While the keyboard is up the page ends at it, the way native chats work:
  // the message box sits on the keyboard and the chat's header stays put.
  // Left alone, iOS slides the whole page up and the header leaves the
  // screen. The page is told too, so the bar copy steps aside.
  const keyboardUp = keyboardOverlap > 0;
  useEffect(() => {
    webRef.current?.injectJavaScript(keyboardScript(keyboardUp));
  }, [keyboardUp]);

  const handleAddress = useCallback(
    (url: string, arrival: Arrival): LiteVerdict => {
      if (!site) return "block";
      const verdict = checkLiteUrl(site, url);

      if (verdict === "block") {
        // Both layers can report the same tap: count it once.
        if (!blockedShownRef.current) {
          blockedShownRef.current = true;
          track("lite_blocked", { site: site.id });
        }
        const exit: BlockedExit =
          arrival === "tap" ? "stay" : arrival === "move" ? "back" : "home";
        setBlocked({
          // Names the switch that blocked it, e.g. Explore for a hashtag.
          line:
            baseSite && applied
              ? blockedLineFor(baseSite, enabledBlockIds(applied), url)
              : site.blockedLine,
          buttonLabel: exit === "home" ? site.safeHomeLabel : "Go back",
          exit,
        });
        webRef.current?.injectJavaScript(PAUSE_ALL_VIDEOS);
      }
      return verdict;
    },
    [site, baseSite, applied],
  );

  // New settings reach the open page without a reload (the next page load
  // gets them from `injection`), and the current page is checked against
  // them. Skips the first run: the page was built with those settings.
  const pageUpdate = useMemo(
    () => (site ? buildLiteUpdate(site, { reelLimit }) : ""),
    [site, reelLimit],
  );
  const sentUpdateRef = useRef("");
  useEffect(() => {
    if (!pageUpdate) return;
    const firstRun = !sentUpdateRef.current;
    const unchanged = sentUpdateRef.current === pageUpdate;
    sentUpdateRef.current = pageUpdate;
    if (firstRun || unchanged) return;
    webRef.current?.injectJavaScript(pageUpdate);
    const url = currentUrlRef.current;
    if (url) handleAddress(url, "recheck");
  }, [pageUpdate, handleAddress]);

  // Full page loads. Returning false cancels the load.
  function onShouldStartLoad(request: ShouldStartLoadRequest): boolean {
    // Subframes (embeds, ads) aren't navigation.
    if (request.isTopFrame === false) return true;
    const verdict = handleAddress(request.url, "load");
    // Decided before the page loads, so a login page never gets the script.
    if (verdict === "allow" && site) {
      setScriptOff(isNoScriptUrl(site, request.url));
    }
    if (verdict === "external") {
      // Other schemes (like instagram://) are dropped.
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

  function showReelLimit() {
    if (!site || !applied) return;
    if (!blockedShownRef.current) {
      blockedShownRef.current = true;
      track("lite_blocked", { site: site.id });
    }
    webRef.current?.injectJavaScript(PAUSE_ALL_VIDEOS);
    const count = applied.dmReelLimit;
    setBlocked({
      line: `That's your ${count} reel${count === 1 ? "" : "s"}.`,
      buttonLabel: "Back to the chat",
      exit: "chat",
    });
  }

  function onMessage(event: WebViewMessageEvent) {
    const message = parseLiteMessage(event.nativeEvent.data);
    if (!message) return;
    switch (message.type) {
      case "nav":
        // The page changed its URL without a load (pushState).
        currentUrlRef.current = message.url;
        handleAddress(message.url, "move");
        return;
      case "tapBlocked":
        // The page already stopped the tap. If this check disagrees, follow
        // the link after all rather than leave a dead tap.
        if (handleAddress(message.url, "tap") === "allow") {
          webRef.current?.injectJavaScript(
            `window.location.assign(${JSON.stringify(message.url)}); true;`,
          );
        }
        return;
      case "ready":
        setOpening(false);
        return;
      case "colors":
        setEdgeColors({ top: message.top, bottom: message.bottom });
        return;
      case "reelLimit":
        showReelLimit();
        return;
    }
  }

  function closeBlocked() {
    if (!site || !blocked) return;
    const { exit } = blocked;
    setBlocked(null);
    blockedShownRef.current = false;
    const web = webRef.current;
    if (!web) return;

    if (exit === "stay") {
      web.injectJavaScript(RESUME_VIDEOS);
      return;
    }
    if (exit === "back") {
      web.injectJavaScript("history.back(); true;");
      // Videos play again only once the page has left the blocked address.
      // If it didn't leave, the start page loads instead.
      if (backCheckRef.current) clearTimeout(backCheckRef.current);
      backCheckRef.current = setTimeout(() => {
        const url = currentUrlRef.current;
        if (url && checkLiteUrl(site, url) !== "block") {
          webRef.current?.injectJavaScript(RESUME_VIDEOS);
          return;
        }
        setBlocked(null);
        blockedShownRef.current = false;
        webRef.current?.injectJavaScript(loadPageScript(site.startUrl));
      }, BACK_CHECK_MS);
      return;
    }
    // Reloading the chat closes the reel viewer.
    web.injectJavaScript(
      exit === "chat"
        ? "window.location.replace(window.location.href); true;"
        : loadPageScript(site.startUrl),
    );
  }

  function leaveToPage() {
    if (router.canGoBack()) router.back();
    else router.replace("/lite");
  }

  function retry() {
    setFailed(false);
    setStopped(false);
    setLoaded(false);
    setOpening(true);
    setAttempt((count) => count + 1);
  }

  // iOS killed the web content process (usually for memory while the app was
  // in the background), which leaves the page blank. Reload, unless it
  // happened again within 30s: then ask, rather than loop.
  function onPageStopped() {
    const now = Date.now();
    const stoppedAgain = now - lastStopAtRef.current < 30_000;
    lastStopAtRef.current = now;
    if (stoppedAgain) {
      setStopped(true);
      return;
    }
    setLoaded(false);
    setOpening(true);
    webRef.current?.reload();
  }

  function applySettingsAndClose() {
    setSettingsOpen(false);
    if (JSON.stringify(liteSettings.settings) === JSON.stringify(applied))
      return;
    setApplied(liteSettings.settings);
    // The page under the card may be allowed now. The check after the update
    // puts the card back if it isn't.
    if (blocked) {
      setBlocked(null);
      blockedShownRef.current = false;
      webRef.current?.injectJavaScript(RESUME_VIDEOS);
    }
  }

  function shareLink() {
    const url = currentUrlRef.current ?? site?.startUrl;
    if (url) void Share.share({ url, message: url }).catch(() => {});
  }

  const fullInjection = useMemo(
    () => (site ? buildLiteInjection(site, { reelLimit }) : ""),
    [site, reelLimit],
  );
  // Takes effect from the next page load.
  const injection = scriptOff ? undefined : fullInjection;

  // Unknown site or kill switch off.
  useEffect(() => {
    if (!baseSite) router.back();
  }, [baseSite]);

  if (!fontsLoaded || !baseSite || !site || !applied) return null;

  // The app's own full-screen covers, apart from the loading one.
  const coverShown =
    !NativeWebView || failed || stopped || !!blocked || reminderShown;
  const loadingCoverUp = !!NativeWebView && !coverGone;
  // Instagram's page doesn't allow for the safe areas (Safari never draws a
  // page under the status bar), so it's inset and the strips are painted its
  // edge colours. Login pages have no script to report colours, and their
  // form sits low enough to go edge to edge.
  const edgeToEdge = scriptOff;
  const menuTipShown =
    !!intro &&
    intro.signedInOnce &&
    !intro.menuTipDone &&
    !scriptOff &&
    !coverShown &&
    !loadingCoverUp &&
    !settingsOpen;
  const fallback = isDark ? DARK_PAGE : LIGHT_PAGE;
  const topColor = edgeColors?.top ?? fallback;
  const bottomColor = edgeColors?.bottom ?? fallback;
  const pageFrame = edgeToEdge
    ? StyleSheet.absoluteFill
    : {
        ...StyleSheet.absoluteFillObject,
        top: insets.top,
        bottom: keyboardUp ? keyboardOverlap : insets.bottom,
      };
  const statusStyle =
    coverShown || loadingCoverUp
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
            {/* With the keyboard up, this also fills the space it's sliding
                into, in the page's own colour. */}
            <View
              style={[
                styles.strip,
                {
                  bottom: 0,
                  height: Math.max(insets.bottom, keyboardOverlap),
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
            // "*" sends every URL through onShouldStartLoadWithRequest. With
            // the default, the library opens other schemes itself, so
            // instagram:// links launched the native app.
            originWhitelist={["*"]}
            source={{ uri: site.startUrl }}
            // Runs before the page's own code, so no URL change is missed.
            injectedJavaScriptBeforeContentLoaded={injection}
            onShouldStartLoadWithRequest={onShouldStartLoad}
            onMessage={onMessage}
            onNavigationStateChange={(nav) => {
              setCanGoBack(nav.canGoBack);
              setCanGoForward(nav.canGoForward);
              currentUrlRef.current = nav.url;
              if (
                !signedInSavedRef.current &&
                !nav.loading &&
                isSignedInUrl(site, nav.url)
              ) {
                signedInSavedRef.current = true;
                if (!intro?.signedInOnce) markDone("signedInOnce");
              }
              // Left a login page without a full load. The script skips
              // itself if it's already there.
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
            // Don't wait for every image.
            onLoadProgress={(event) => {
              if (event.nativeEvent.progress >= 0.75) setLoaded(true);
            }}
            onLoadEnd={() => setLoaded(true)}
            onError={() => {
              setFailed(true);
              setOpening(false);
            }}
            onContentProcessDidTerminate={onPageStopped}
            allowsInlineMediaPlayback
            // Left out, react-native-webview 13 sets the scroll view's
            // deceleration to 0 on every drag, so a flick stops the moment
            // the finger lifts. "normal" is Safari's own glide.
            decelerationRate="normal"
            // The arrows-and-tick bar above the keyboard belongs to web forms;
            // a chat app has none. Login pages keep it to move between boxes.
            hideKeyboardAccessoryView={!edgeToEdge}
            webviewDebuggingEnabled={__DEV__}
            // A long-press preview would load blocked links in the background.
            allowsLinkPreview={false}
            // Off on the first page, so the edge swipe leaves the browser.
            allowsBackForwardNavigationGestures={canGoBack}
            // pageFrame already handles the safe areas.
            contentInsetAdjustmentBehavior="never"
            style={pageFrame}
          />
        ) : null}

        {loadingCoverUp ? (
          <Animated.View
            pointerEvents={opening ? "auto" : "none"}
            style={[StyleSheet.absoluteFill, { opacity: coverOpacity }]}
          >
            <LiteStatusPanel label={`OPENING ${site.label.toUpperCase()}`} />
          </Animated.View>
        ) : null}

        {/* The other covers and the ⋯ button. Touches elsewhere pass through
            to the page. */}
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
                onBack={closeBlocked}
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

            {/* Last, so it sits on top. */}
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
              // A tap before the hint showed counts too.
              onTipDone={() => {
                if (intro && !intro.menuTipDone) markDone("menuTipDone");
              }}
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
  // Cream, so a loading page never flashes white.
  body: { flex: 1, backgroundColor: T.cream },
  layer: { flex: 1 },
  strip: { position: "absolute", left: 0, right: 0 },
  cover: { backgroundColor: T.cream },
});
