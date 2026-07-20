import { useMemo } from "react";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "./categories";

export function useSettingsSearch(query: string, visible: SettingsCategory[]): SettingsCategory[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;

    const visibleIds = new Set(visible.map((c) => c.id));
    return SETTINGS_CATEGORIES.filter(
      (c) =>
        visibleIds.has(c.id) &&
        (c.label.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.searchTerms.some((term) => term.toLowerCase().includes(q)))
    );
  }, [query, visible]);
}
