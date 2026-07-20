"use client";

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 24;
const KNOB_SIZE = 18;
const KNOB_INSET = 3;

export default function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "border-[#c9a96e] bg-[#c9a96e]/80" : "border-[#c9a96e]/25 bg-[#14100a]"
      }`}
      style={{
        display: "inline-block",
        boxSizing: "border-box",
        width: TRACK_WIDTH,
        height: TRACK_HEIGHT,
        minWidth: TRACK_WIDTH,
        maxWidth: TRACK_WIDTH,
        padding: 0,
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    >
      <span
        className={`absolute rounded-full transition-transform ${checked ? "bg-[#1a0e00]" : "bg-[#0b0906]"}`}
        style={{
          top: KNOB_INSET,
          left: KNOB_INSET,
          height: KNOB_SIZE,
          width: KNOB_SIZE,
          transform: checked ? `translateX(${TRACK_WIDTH - KNOB_SIZE - KNOB_INSET * 2}px)` : "translateX(0)",
        }}
      />
    </button>
  );
}
