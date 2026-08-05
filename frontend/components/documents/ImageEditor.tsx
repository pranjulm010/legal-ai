"use client";

import { useEffect, useRef, useState } from "react";

type Tool = "pen" | "text";

const PEN_COLORS = ["#e5484d", "#111111", "#ffffff", "#2563eb"];
const PEN_SIZES = [
  { label: "Fine", value: 3 },
  { label: "Medium", value: 8 },
  { label: "Thick", value: 20 },
];

// Converts a pointer event's page coordinates into canvas pixel space,
// correcting for any CSS scaling between the canvas's backing resolution
// (kept at the original image's natural size, so OCR quality is preserved
// on save) and the smaller size it's actually displayed at on screen.
function toCanvasPoint(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

export default function ImageEditor({
  imageBlob,
  fileName,
  saving,
  error,
  onSave,
  onClose,
}: {
  imageBlob: Blob;
  fileName: string;
  saving: boolean;
  error: string | null;
  onSave: (blob: Blob) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const originalImageRef = useRef<HTMLImageElement | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(PEN_SIZES[1].value);
  const [canUndo, setCanUndo] = useState(false);
  const [ready, setReady] = useState(false);
  const [textPrompt, setTextPrompt] = useState<
    { x: number; y: number; displayLeft: number; displayTop: number } | null
  >(null);
  const [textDraft, setTextDraft] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(imageBlob);
    const image = new Image();
    image.onload = () => {
      originalImageRef.current = image;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(image, 0, 0);
      setReady(true);
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageBlob]);

  const pushUndoSnapshot = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    // Cap history so a long editing session can't grow this unbounded.
    if (undoStackRef.current.length > 30) undoStackRef.current.shift();
    setCanUndo(true);
  };

  const handleUndo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const snapshot = undoStackRef.current.pop();
    if (!canvas || !ctx || !snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
    setCanUndo(undoStackRef.current.length > 0);
  };

  const handleReset = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const image = originalImageRef.current;
    if (!canvas || !ctx || !image) return;
    pushUndoSnapshot();
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx.drawImage(image, 0, 0);
  };

  const handleRotate = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    pushUndoSnapshot();

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.height;
    offscreen.height = canvas.width;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;
    offCtx.translate(offscreen.width / 2, offscreen.height / 2);
    offCtx.rotate(Math.PI / 2);
    offCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

    canvas.width = offscreen.width;
    canvas.height = offscreen.height;
    ctx.drawImage(offscreen, 0, 0);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas) return;
    const point = toCanvasPoint(canvas, event);

    if (tool === "text") {
      setTextDraft("");
      if (container) {
        const containerRect = container.getBoundingClientRect();
        setTextPrompt({
          ...point,
          displayLeft: event.clientX - containerRect.left + container.scrollLeft,
          displayTop: event.clientY - containerRect.top + container.scrollTop,
        });
      }
      return;
    }

    pushUndoSnapshot();
    drawingRef.current = true;
    lastPointRef.current = point;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const point = toCanvasPoint(canvas, event);
    const last = lastPointRef.current;
    ctx.strokeStyle = color;
    ctx.lineWidth = penSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (last) ctx.moveTo(last.x, last.y);
    else ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  };

  const stopDrawing = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const commitText = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const text = textDraft.trim();
    if (canvas && ctx && textPrompt && text) {
      pushUndoSnapshot();
      const fontSize = Math.max(18, Math.round(canvas.width * 0.02));
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = color;
      ctx.textBaseline = "top";
      ctx.fillText(text, textPrompt.x, textPrompt.y);
    }
    setTextPrompt(null);
    setTextDraft("");
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) onSave(blob);
    }, "image/png");
  };

  return (
    <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-[#c9a96e]/20 bg-[#0f0c08] p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#f0e6cc]">Edit image</h2>
          <p className="text-xs text-[#8a7c68]">{fileName}</p>
        </div>
        <button onClick={onClose} className="text-xs text-[#8a7c68] hover:text-[#c9a96e]">
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-[#c9a96e]/12 bg-[#14100a] p-2">
        <div className="flex gap-1">
          <button
            onClick={() => setTool("pen")}
            className={`rounded-md px-2 py-1 text-xs ${
              tool === "pen" ? "bg-[#c9a96e] text-[#1a0e00]" : "text-[#c9a96e] hover:bg-[#c9a96e]/10"
            }`}
          >
            Pen
          </button>
          <button
            onClick={() => setTool("text")}
            className={`rounded-md px-2 py-1 text-xs ${
              tool === "text" ? "bg-[#c9a96e] text-[#1a0e00]" : "text-[#c9a96e] hover:bg-[#c9a96e]/10"
            }`}
          >
            Text
          </button>
        </div>

        <div className="flex items-center gap-1">
          {PEN_COLORS.map((swatch) => (
            <button
              key={swatch}
              onClick={() => setColor(swatch)}
              title={swatch}
              className={`h-5 w-5 rounded-full border ${
                color === swatch ? "border-[#c9a96e]" : "border-[#8a7c68]/30"
              }`}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>

        {tool === "pen" && (
          <select
            value={penSize}
            onChange={(event) => setPenSize(Number(event.target.value))}
            className="rounded-md border border-[#c9a96e]/15 bg-transparent px-2 py-1 text-xs text-[#e0d2ba]"
          >
            {PEN_SIZES.map((size) => (
              <option key={size.value} value={size.value} className="bg-[#14100a]">
                {size.label}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex gap-2">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="rounded-md border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#c9a96e] disabled:opacity-40"
          >
            Undo
          </button>
          <button
            onClick={handleRotate}
            className="rounded-md border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#c9a96e]"
          >
            Rotate 90°
          </button>
          <button
            onClick={handleReset}
            className="rounded-md border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#c9a96e]"
          >
            Reset
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto rounded-lg border border-[#c9a96e]/15 bg-[#14100a] p-2"
      >
        {!ready && <p className="py-10 text-center text-sm text-[#8a7c68]">Loading image...</p>}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
          className="mx-auto block max-h-[55vh] w-auto max-w-full touch-none rounded"
          style={{ cursor: tool === "text" ? "text" : "crosshair", display: ready ? "block" : "none" }}
        />

        {textPrompt && (
          <div
            className="absolute z-10 flex items-center gap-1 rounded-md border border-[#c9a96e]/40 bg-[#0f0c08] p-1 shadow-lg"
            style={{ left: `${textPrompt.displayLeft}px`, top: `${textPrompt.displayTop}px` }}
          >
            <input
              autoFocus
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitText();
                if (event.key === "Escape") {
                  setTextPrompt(null);
                  setTextDraft("");
                }
              }}
              placeholder="Type correction..."
              className="w-40 rounded border border-[#c9a96e]/20 bg-[#1a140c] px-2 py-1 text-xs text-[#e0d2ba] outline-none"
            />
            <button
              onClick={commitText}
              className="rounded bg-[#c9a96e] px-2 py-1 text-xs font-semibold text-[#1a0e00]"
            >
              Add
            </button>
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] text-[#5a4f3f]">
        Draw over or add text to correct the image, then save. The knowledge base&rsquo;s
        extracted text is re-OCR&rsquo;d from the saved image and re-indexed automatically.
      </p>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-[#c9a96e]/15 px-3 py-1.5 text-sm text-[#8a7c68]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!ready || saving}
          className="rounded-lg bg-[#c9a96e] px-4 py-1.5 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
