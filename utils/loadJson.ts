import AsyncStorage from "@react-native-async-storage/async-storage";

/** Reads a JSON value from storage, or `fallback` if it's missing or unreadable. */
export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
