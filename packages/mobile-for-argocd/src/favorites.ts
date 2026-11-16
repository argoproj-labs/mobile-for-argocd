import AsyncStorage from "@react-native-async-storage/async-storage";

const FAVORITES_KEY_PREFIX = "argocd:favorites:";

// Favorite app keys, scoped per connection id.
export const favoritesStorage = {
  get: async (connectionId: string): Promise<Set<string>> => {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY_PREFIX + connectionId);
    if (!raw) return new Set();
    try {
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  },
  set: (connectionId: string, favs: Set<string>) =>
    AsyncStorage.setItem(
      FAVORITES_KEY_PREFIX + connectionId,
      JSON.stringify(Array.from(favs)),
    ),
};
