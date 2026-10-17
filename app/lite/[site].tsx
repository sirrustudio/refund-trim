import { router, Stack, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  RELOAD_UNLESS_TYPING,
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
  /** Reel limit hit: the button reloads the chat instead of going home. */
  backToChat?: boolean;
};

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

/** Time in the background after which the page is refreshed on return. */
const REFRESH_AFTER_MS = 30_000;

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

/**
 * The Lite browser: the site's own web page with the switched-off sections
 * blocked. It checks URLs on the phone and never reads messages, logins or
 * what you type.
 */
export default function LiteBrowserScreen() {
  const fontsLoaded = useSirruFonts();
  const isDark = useIsDark();
  const insets = useSafeAreaInsets();
  const { site: siteParam } = useLocalSearchParams<{ site?: string }>();
  const baseSite = findLiteSite(siteParam);

  // `settings` follows the sheet live; `applied` is what the page uses. They
  // sync when the sheet closes, so the page reloads once, not on every tap.
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

  const webRef = useRef<WebView>(null);
  const blockedShownRef = useRef(false);

  const [loading, setLoading] = useState(true);
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

  const handleAddress = useCallback(
    (url: string): LiteVerdict => {
      if (!site) return "block";
      const verdict = checkLiteUrl(site, url);

      if (verdict === "block") {
        // Both layers can report the same tap: count it once.
        if (!blockedShownRef.current) {
          blockedShownRef.current = true;
          track("lite_blocked", { site: site.id });
        }
        setBlocked({ line: site.blockedLine, buttonLabel: site.safeHomeLabel });
        webRef.current?.injectJavaScript(PAUSE_ALL_VIDEOS);
      }
      return verdict;
    },
    [site],
  );

  // Layer 1: full page loads. Returning false cancels the load.
  function onShouldStartLoad(request: ShouldStartLoadRequest): boolean {
    // Subframes (embeds, ads) aren't navigation.
    if (request.isTopFrame === false) return true;
    const verdict = handleAddress(request.url);
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

  // Layer 2: the page changed its URL without a load (pushState).
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
    // Reel limit hit in the DMs.
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
      backToChat: true,
    });
  }

  function goSafeHome() {
    if (!site) return;
    setBlocked(null);
    blockedShownRef.current = false;
    // Reloading the chat closes the reel viewer.
    const target = blocked?.backToChat
      ? "window.location.href"
      : JSON.stringify(site.startUrl);
    webRef.current?.injectJavaScript(
      `window.location.replace(${target}); true;`,
    );
  }

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
    setLoading(true);
    webRef.current?.reload();
  }

  function applySettingsAndClose() {
    setSettingsOpen(false);
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

  const fullInjection = useMemo(
    () =>
      baseSite && site && applied
        ? buildLiteInjection(site, {
            reelLimit: baseSite.dmReelViewer ? applied.dmReelLimit : 0,
          })
        : "",
    [baseSite, site, applied],
  );
  // Takes effect from the next page load.
  const injection = scriptOff ? undefined : fullInjection;

  // Unknown site or kill switch off.
  useEffect(() => {
    if (!baseSite) router.back();
  }, [baseSite]);

  if (!fontsLoaded || !baseSite || !site || !applied) return null;

  // The app's own full-screen cover.
  const coverShown =
    !NativeWebView ||
    loading ||
    failed ||
    stopped ||
    !!blocked ||
    reminderShown;
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
              if (event.nativeEvent.progress >= 0.75) setLoading(false);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={() => setFailed(true)}
            onContentProcessDidTerminate={onPageStopped}
            allowsInlineMediaPlayback
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

        {/* Covers and the ⋯ button. Touches elsewhere pass through to the
            page. */}
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
