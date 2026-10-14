import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadJson } from '@/utils/loadJson';

const KEY = 'liteIntro';

/**
 * The first-time help around Reel-free, each shown until it's done.
 * One key, so a reset clears them together.
 */
export type LiteIntro = {
  /** Today's "one swipe left" card: dismissed, or the page was opened. */
  todayCardDone: boolean;
  /** The note on Instagram's login page: dismissed with "Got it". */
  loginNoteDone: boolean;
  /** A signed-in page has loaded once, so the login help is no longer needed. */
  signedInOnce: boolean;
};

export const EMPTY_LITE_INTRO: LiteIntro = {
  todayCardDone: false,
  loginNoteDone: false,
  signedInOnce: false,
};

/** Stored data is checked, not trusted: only a real `true` counts as done. */
export async function loadLiteIntro(): Promise<LiteIntro> {
  const stored = await loadJson<unknown>(KEY, null);
  if (typeof stored !== 'object' || stored === null) return EMPTY_LITE_INTRO;
  const data = stored as Record<string, unknown>;
  return {
    todayCardDone: data.todayCardDone === true,
    loginNoteDone: data.loginNoteDone === true,
    signedInOnce: data.signedInOnce === true,
  };
}

// Saves run one after another. Today and the browser can both mark something
// at nearly the same moment; without the queue, the second save could read the
// old value and write over the first one's flag.
let queue: Promise<unknown> = Promise.resolve();

export type LiteIntroStep = keyof LiteIntro;

/** Marks steps as done. There's no way back: a done step never shows again. */
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

/** Dev screens only: every first-time step shows again. */
export function resetLiteIntro(): Promise<void> {
  const run = queue.then(() => AsyncStorage.removeItem(KEY));
  queue = run.catch(() => {});
  return run;
}
