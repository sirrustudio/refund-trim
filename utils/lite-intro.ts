import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadJson } from "@/utils/loadJson";

const KEY = "liteIntro";

/**
 * Trim's one-time help, each step shown until it's done. One key, so a reset
 * clears all of them.
 */
export type LiteIntro = {
  /** Today's "one swipe left" card was dismissed, or Trim was opened. */
  todayCardDone: boolean;
  /** A signed-in page has loaded, so the login help is no longer needed. */
  signedInOnce: boolean;
  /** The browser's ⋯ button was tapped or dragged, so its hint is retired. */
  menuTipDone: boolean;
  /** The toolbar was opened and closed once, so its icon labels are retired. */
  menuNamesDone: boolean;
};

export const EMPTY_LITE_INTRO: LiteIntro = {
  todayCardDone: false,
  signedInOnce: false,
  menuTipDone: false,
  menuNamesDone: false,
};

/** Stored data isn't trusted: only a real `true` counts as done. */
export async function loadLiteIntro(): Promise<LiteIntro> {
  const stored = await loadJson<unknown>(KEY, null);
  if (typeof stored !== "object" || stored === null) return EMPTY_LITE_INTRO;
  const data = stored as Record<string, unknown>;
  return {
    todayCardDone: data.todayCardDone === true,
    signedInOnce: data.signedInOnce === true,
    menuTipDone: data.menuTipDone === true,
    menuNamesDone: data.menuNamesDone === true,
  };
}

// Saves run one at a time. Today and the browser can mark steps at nearly the
// same moment; without the queue, the second save could read stale data and
// drop the first one's flag.
let queue: Promise<unknown> = Promise.resolve();

export type LiteIntroStep = keyof LiteIntro;

/** Marks steps as done. One-way: a done step never shows again. */
export function markLiteIntro(steps: LiteIntroStep[]): Promise<LiteIntro> {
  const run = queue.then(async () => {
    const next = { ...(await loadLiteIntro()) };
    for (const step of steps) next[step] = true;
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A failed save just means the help shows once more.
    }
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

/** Dev screens only: shows every step again. */
export function resetLiteIntro(): Promise<void> {
  const run = queue.then(() => AsyncStorage.removeItem(KEY));
  queue = run.catch(() => {});
  return run;
}
