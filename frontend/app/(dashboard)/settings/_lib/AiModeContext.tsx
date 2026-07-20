"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getAiProviderMode,
  type AIProviderMode,
} from "@/lib/api";

interface AiModeContextValue {
  mode: AIProviderMode;
  hasConnectedCredential: boolean;
  loading: boolean;
  setMode: (mode: AIProviderMode, hasConnectedCredential: boolean) => void;
  refresh: () => void;
}

const AiModeContext = createContext<AiModeContextValue | null>(null);

export function AiModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AIProviderMode>("PLATFORM");
  const [hasConnectedCredential, setHasConnectedCredential] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    getAiProviderMode()
      .then((status) => {
        setModeState(status.provider_mode);
        setHasConnectedCredential(status.has_connected_credential);
      })
      .catch(() => {
        // Fail silent - default PLATFORM keeps the tab list conservative
        // (API Integrations hidden) rather than guessing.
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMode = (next: AIProviderMode, nextHasConnectedCredential: boolean) => {
    setModeState(next);
    setHasConnectedCredential(nextHasConnectedCredential);
  };

  return (
    <AiModeContext.Provider value={{ mode, hasConnectedCredential, loading, setMode, refresh }}>
      {children}
    </AiModeContext.Provider>
  );
}

export function useAiMode(): AiModeContextValue {
  const ctx = useContext(AiModeContext);
  if (!ctx) throw new Error("useAiMode must be used within an AiModeProvider");
  return ctx;
}
