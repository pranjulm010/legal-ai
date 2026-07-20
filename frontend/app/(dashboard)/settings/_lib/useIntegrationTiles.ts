import { useEffect, useState } from "react";
import { getFirmSettings, updateFirmSettings } from "@/lib/api";
import type { IntegrationTileState } from "../_components/IntegrationTile";

type TilesState = Record<string, IntegrationTileState>;

// Loads/persists a set of IntegrationTile states (one per provider id) into
// FirmSettings' "mock" namespace under `categoryId`. Shared by every
// mock integrations-style category (Database Connections, API
// Integrations, Legal Research Providers, Email & Communication) so each
// only has to define its own provider list and field schema.
export function useIntegrationTiles(categoryId: string, providerIds: string[]) {
  const [state, setState] = useState<TilesState | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFirmSettings()
      .then((data) => {
        if (cancelled) return;
        const stored = (data.mock?.[categoryId] as TilesState) || {};
        const merged: TilesState = {};
        for (const id of providerIds) {
          merged[id] = stored[id] || { enabled: false, values: {} };
        }
        setState(merged);
      })
      .catch(() => {
        const fallback: TilesState = {};
        for (const id of providerIds) fallback[id] = { enabled: false, values: {} };
        if (!cancelled) setState(fallback);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const updateTile = (id: string, next: IntegrationTileState) => {
    setState((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [id]: next };
      updateFirmSettings("mock", { [categoryId]: updated }).catch(() => {});
      return updated;
    });
  };

  return { state, updateTile };
}
