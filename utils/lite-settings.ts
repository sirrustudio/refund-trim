import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadJson } from "@/utils/loadJson";
import { LITE_SITES } from "@/utils/lite-sites";

const KEY = "liteSettings";

/** Reels allowed per DM visit. 0 means no limit. */
export const DM_REEL_CHOICES = [1, 2, 3, 5, 0] as const;

/** Minutes before the gentle stop. 0 means off. */
export const REMINDER_CHOICES = [0, 5, 10, 15, 30] as const;

/** Per-app settings. An old saved `grayscale` (since removed) is ignored. */
export type LiteSiteLook = {
  /** Gentle stop after this many minutes (one of REMINDER_CHOICES). */
  reminderMins: number;
};

export const DEFAULT_SITE_LOOK: LiteSiteLook = {
  reminderMins: 0,
};

export type LiteSettings = {
  /** Reels allowed per DM visit; 0 means no limit. */
  dmReelLimit: number;
  /**
   * The user's choice per switch id. A missing id has never been touched and
   * uses the switch's defaultOn (see lite-sites.ts).
   */
  blocks: Record<string, boolean>;
  /**
   * Per-app settings by site id. A missing id has never been touched and uses
   * DEFAULT_SITE_LOOK (read it with getSiteLook).
   */
  sites: Record<string, LiteSiteLook>;
};

export const DEFAULT_LITE_SETTINGS: LiteSettings = {
  dmReelLimit: 2,
  blocks: {},
  sites: {},
};

// Last settings loaded or saved in this session. The browser reads it
// synchronously, so the page can start loading without waiting for storage.
let cachedSettings: LiteSettings | null = null;

/** The settings if they were already loaded or saved this session, else null. */
export function peekLiteSettings(): LiteSettings | null {
  return cachedSettings;
}

const ALL_BLOCKS = LITE_SITES.flatMap((site) => site.optionalBlocks ?? []);

async function readLiteSettings(): Promise<LiteSettings> {
  const stored = await loadJson<unknown>(KEY, DEFAULT_LITE_SETTINGS);
  if (typeof stored !== "object" || stored === null) {
    return DEFAULT_LITE_SETTINGS;
  }
  const data = stored as Record<string, unknown>;

  // Stored data isn't trusted: only real booleans for known ids are kept.
  const blocks: Record<string, boolean> = {};
  const savedBlocks =
    typeof data.blocks === "object" && data.blocks !== null
      ? (data.blocks as Record<string, unknown>)
      : {};
  for (const block of ALL_BLOCKS) {
    if (typeof savedBlocks[block.id] === "boolean") {
      blocks[block.id] = savedBlocks[block.id] as boolean;
    }
  }

  // Older versions stored one gentle-stop value for all apps. If that's what's
  // saved, every app starts from it; the next save writes the new shape.
  const legacyLook = readSiteLook(data);
  const savedSites =
    typeof data.sites === "object" && data.sites !== null
      ? (data.sites as Record<string, unknown>)
      : null;
  const sites: Record<string, LiteSiteLook> = {};
  for (const site of LITE_SITES) {
    const saved = savedSites?.[site.id];
    if (typeof saved === "object" && saved !== null) {
      sites[site.id] = readSiteLook(saved as Record<string, unknown>);
    } else if (!savedSites) {
      sites[site.id] = legacyLook;
    }
  }

  return {
    dmReelLimit: (DM_REEL_CHOICES as readonly number[]).includes(
      data.dmReelLimit as number,
    )
      ? (data.dmReelLimit as number)
      : DEFAULT_LITE_SETTINGS.dmReelLimit,
    blocks,
    sites,
  };
}

/** Validates one stored look: only a known minute count passes. */
function readSiteLook(data: Record<string, unknown>): LiteSiteLook {
  return {
    reminderMins: (REMINDER_CHOICES as readonly number[]).includes(
      data.reminderMins as number,
    )
      ? (data.reminderMins as number)
      : 0,
  };
}

/** One app's settings, or the defaults. */
export function getSiteLook(
  settings: LiteSettings,
  siteId: string,
): LiteSiteLook {
  return settings.sites[siteId] ?? DEFAULT_SITE_LOOK;
}

export async function getLiteSettings(): Promise<LiteSettings> {
  cachedSettings = await readLiteSettings();
  return cachedSettings;
}

export async function saveLiteSettings(settings: LiteSettings): Promise<void> {
  cachedSettings = settings;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // If the save fails, the switch just reverts on the next launch.
  }
}

/** Ids of every switch that's on, using defaults for untouched ones. */
export function enabledBlockIds(settings: LiteSettings): string[] {
  return ALL_BLOCKS.filter(
    (block) => settings.blocks[block.id] ?? block.defaultOn,
  ).map((block) => block.id);
}
