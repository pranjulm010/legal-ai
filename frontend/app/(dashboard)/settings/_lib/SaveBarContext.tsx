"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

export interface SaveBarState {
  isDirty: boolean;
  saving: boolean;
  label?: string;
  onSave: () => void;
  onDiscard: () => void;
}

// Only the primitive fields the bar actually needs to decide whether to
// re-render/show itself - comparing these by value in a dependency array
// (instead of the whole SaveBarState object, which is a fresh reference
// every render) is what keeps registration from looping.
interface SaveBarSignal {
  isDirty: boolean;
  saving: boolean;
  label?: string;
}

interface SaveBarContextValue {
  stateRef: React.MutableRefObject<SaveBarState | null>;
  signal: SaveBarSignal | null;
  setSignal: (signal: SaveBarSignal | null) => void;
}

const SaveBarContext = createContext<SaveBarContextValue | undefined>(undefined);

export function SaveBarProvider({ children }: { children: React.ReactNode }) {
  const stateRef = useRef<SaveBarState | null>(null);
  const [signal, setSignal] = useState<SaveBarSignal | null>(null);

  return (
    <SaveBarContext.Provider value={{ stateRef, signal, setSignal }}>{children}</SaveBarContext.Provider>
  );
}

function useSaveBarContext(): SaveBarContextValue {
  const ctx = useContext(SaveBarContext);
  if (!ctx) throw new Error("useSaveBarContext must be used within SaveBarProvider");
  return ctx;
}

// SaveBar calls this to render. `stateRef.current` always holds the latest
// onSave/onDiscard closures (updated synchronously during the active
// panel's render, which happens before SaveBar's own render since it's
// mounted earlier in the tree) - `signal` is only here to make this hook
// re-render when isDirty/saving/label actually change.
export function useSaveBarState(): SaveBarState | null {
  const { stateRef, signal } = useSaveBarContext();
  return signal ? stateRef.current : null;
}

// The active panel calls this every render with its current dirty/saving
// state and save/discard handlers. The ref is updated unconditionally (so
// clicking Save always runs the latest closure, even mid-typing) without
// triggering a re-render; only a real change to isDirty/saving/label
// updates React state, and that state holds primitives (not the whole
// state object, which is a new reference every render) - so this can't
// loop the way registering the full object on every render would.
export function useRegisterSaveBar(state: SaveBarState | null) {
  const { stateRef, setSignal } = useSaveBarContext();
  stateRef.current = state;

  const isDirty = state?.isDirty ?? false;
  const saving = state?.saving ?? false;
  const label = state?.label;

  useEffect(() => {
    setSignal(state ? { isDirty, saving, label } : null);
    return () => setSignal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(state), isDirty, saving, label]);
}
