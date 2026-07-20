"use client";

import { createContext, useContext } from "react";
import type { AiProviderModeValue } from "@/lib/api";

export interface AiModeContextValue {
  // null while not yet loaded - treated the same as "platform_managed" for
  // hiding the API Integrations tab, so it never flashes visible before the
  // real mode is known.
  mode: AiProviderModeValue | null;
  // Panels call this after successfully switching mode so the shell's tab
  // visibility (API Integrations is hidden in platform_managed mode)
  // updates immediately, without a page reload.
  refresh: () => void;
}

export const AiModeContext = createContext<AiModeContextValue>({
  mode: null,
  refresh: () => {},
});

export function useAiModeContext(): AiModeContextValue {
  return useContext(AiModeContext);
}
