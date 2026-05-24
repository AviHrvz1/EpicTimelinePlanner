"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * LinkedIn-style image editor used by the Add User and Edit User drawers.
 *
 * Pipeline:
 *  1. Caller passes the source image (data URL or remote URL). Component owns
 *     all crop / filter / adjust state for the editing session.
 *  2. On Save, transforms are baked into a single off-screen canvas, exported
 *     as a JPEG blob, posted to `/api/uploads/avatar`, and the resulting URL
 *     is handed back to the caller via `onSave(url)`.
 *
 * Why react-easy-crop: handles drag-to-pan + zoom + rotate + responsive crop
 * computation against a fixed aspect ratio. We compute the final image from
 * its `pixelCrop` callback so the bake is one canvas draw, not a chain.
 *
 * Filters/Adjust are applied by setting `ctx.filter` before the final draw —
 * not via CSS so the result baked into the upload matches the preview pixel
 * for pixel.
 */

const ASPECT = 1;
const OUTPUT_SIZE = 512;
const JPEG_QUALITY = 0.92;

type TabKey = "crop" | "filter" | "adjust";

type FilterPreset = {
  key: string;
  label: string;
  /** CSS `filter` string applied to both preview and final canvas. */
  filter: string;
};

const FILTER_PRESETS: FilterPreset[] = [
  { key: "none", label: "Original", filter: "none" },
  { key: "bw", label: "B&W", filter: "grayscale(1)" },
  { key: "sepia", label: "Sepia", filter: "sepia(0.85)" },
  { key: "vivid", label: "Vivid", filter: "saturate(1.45) contrast(1.08)" },
  { key: "cool", label: "Cool", filter: "saturate(1.1) hue-rotate(-10deg) brightness(1.02)" },
  { key: "warm", label: "Warm", filter: "saturate(1.1) hue-rotate(10deg) brightness(1.02)" },
  { key: "fade", label: "Fade", filter: "contrast(0.9) brightness(1.06) saturate(0.9)" },
  { key: "noir", label: "Noir", filter: "grayscale(1) contrast(1.18)" },
];

export type EditImageDialogProps = {
  open: boolean;
  /** Source image as a data URL or remote URL. Component reads, never writes. */
  src: string | null;
  /** Called when the user clicks Save with a freshly-uploaded URL. */
  onSave: (url: string) => void;
  onClose: () => void;
  /** Lets the caller swap to a different image without re-mounting the dialog. */
  onPickAnother?: () => void;
};

export function EditImageDialog({ open, src, onSave, onClose, onPickAnother }: EditImageDialogProps) {
  const [tab, setTab] = useState<TabKey>("crop");

  // Crop state
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  /** Combined rotation = crop's discrete rotation + straighten's fine tilt. */
  const [rotation, setRotation] = useState(0);
  const [straighten, setStraighten] = useState(0); // -45..+45 degrees
  /** Negative scale = mirror. Kept on the bake step (react-easy-crop doesn't flip natively). */
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  // Filter / adjust state
  const [filterKey, setFilterKey] = useState<string>("none");
  const [brightness, setBrightness] = useState(100); // %
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset everything whenever a new image is loaded so going from one upload
  // to another doesn't carry stale crop / filter state.
  useEffect(() => {
    if (!open || !src) return;
    setTab("crop");
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setStraighten(0);
    setFlipH(false);
    setFlipV(false);
    setCroppedArea(null);
    setFilterKey("none");
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
    setError(null);
  }, [open, src]);

  // Compose the CSS filter string the cropper preview uses. Same string is
  // also applied during the bake so the upload matches what the user sees.
  const cssFilter = useMemo(() => {
    const preset = FILTER_PRESETS.find((p) => p.key === filterKey)?.filter ?? "none";
    const adjust = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    if (preset === "none") return adjust;
    return `${preset} ${adjust}`;
  }, [filterKey, brightness, contrast, saturation]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  }, []);

  const handleSave = useCallback(async () => {
    if (!src || !croppedArea) return;
    setError(null);
    setSaving(true);
    try {
      const blob = await renderCroppedBlob({
        src,
        area: croppedArea,
        rotation: rotation + straighten,
        flipH,
        flipV,
        cssFilter,
      });
      const form = new FormData();
      form.append("file", blob, "avatar.jpg");
      const res = await fetch("/api/uploads/avatar", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      const data = (await res.json()) as { url: string };
      onSave(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [src, croppedArea, rotation, straighten, flipH, flipV, cssFilter, onSave]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-image-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/20 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className={cn(
          // Soft indigo halo so the dialog reads as elevated even when the
          // backdrop is lighter — matches the delete-confirmation pattern
          // (`ring-4 ring-rose-100/70`) but uses the project's neutral
          // editor palette instead of rose.
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-indigo-200/80 bg-white shadow-2xl ring-4 ring-indigo-100/60 animate-in fade-in zoom-in-95 duration-150",
          // Once the image is loaded the cropper preview drives the visual
          // weight; the right-rail controls fit comfortably in ~800px. While
          // the picker is still empty we keep the wider 1100px so the
          // "no image selected" state doesn't feel cramped.
          src ? "max-w-[860px]" : "max-w-[1100px]",
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id="edit-image-title" className="text-[16px] font-semibold text-slate-900">
            Edit image
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={saving}
            className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body: left preview, right controls */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Preview */}
          <div className="relative min-h-[320px] flex-1 bg-slate-100 md:min-h-0">
            {src ? (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                rotation={rotation + straighten}
                aspect={ASPECT}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onRotationChange={setRotation}
                onCropComplete={onCropComplete}
                /* react-easy-crop renders its own <img>; we apply the live
                 * filter via a media style hook on the wrapper. */
                style={{
                  containerStyle: { background: "#f1f5f9" },
                  mediaStyle: {
                    filter: cssFilter,
                    transform: `scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
                  },
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-slate-500">
                No image selected.
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex w-full shrink-0 flex-col border-l border-slate-200 md:w-[340px]">
            {/* Tabs */}
            <div className="flex shrink-0 items-center gap-6 border-b border-slate-200 px-5 pt-3">
              {(["crop", "filter", "adjust"] as TabKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "relative -mb-px py-2 text-[13px] font-semibold capitalize transition-colors",
                    tab === key
                      ? "text-slate-900"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  {key}
                  {tab === key ? (
                    <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-slate-900" />
                  ) : null}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === "crop" ? (
                <CropPanel
                  zoom={zoom}
                  onZoomChange={setZoom}
                  straighten={straighten}
                  onStraightenChange={setStraighten}
                  onRotate={(dir) =>
                    setRotation((r) => ((r + (dir === "cw" ? 90 : -90)) % 360 + 360) % 360)
                  }
                  onFlipH={() => setFlipH((v) => !v)}
                  onFlipV={() => setFlipV((v) => !v)}
                />
              ) : tab === "filter" ? (
                <FilterPanel
                  src={src}
                  cssFilter={cssFilter}
                  active={filterKey}
                  onPick={setFilterKey}
                />
              ) : (
                <AdjustPanel
                  brightness={brightness}
                  contrast={contrast}
                  saturation={saturation}
                  onBrightnessChange={setBrightness}
                  onContrastChange={setContrast}
                  onSaturationChange={setSaturation}
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
              <div className="flex items-center gap-2">
                {onPickAnother ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-3 text-[12.5px]"
                    onClick={onPickAnother}
                    disabled={saving}
                  >
                    Choose file
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {error ? <span className="text-[11.5px] text-rose-600">{error}</span> : null}
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-full bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-500"
                  onClick={handleSave}
                  disabled={!src || !croppedArea || saving}
                >
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab panels ────────────────────────────────────────────────────────────

function CropPanel({
  zoom,
  onZoomChange,
  straighten,
  onStraightenChange,
  onRotate,
  onFlipH,
  onFlipV,
}: {
  zoom: number;
  onZoomChange: (v: number) => void;
  straighten: number;
  onStraightenChange: (v: number) => void;
  onRotate: (dir: "ccw" | "cw") => void;
  onFlipH: () => void;
  onFlipV: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <IconBtn label="Rotate counter-clockwise" onClick={() => onRotate("ccw")}>
          <RotateCcw className="size-4" />
        </IconBtn>
        <IconBtn label="Rotate clockwise" onClick={() => onRotate("cw")}>
          <RotateCw className="size-4" />
        </IconBtn>
        <IconBtn label="Flip horizontal" onClick={onFlipH}>
          <FlipHorizontal2 className="size-4" />
        </IconBtn>
        <IconBtn label="Flip vertical" onClick={onFlipV}>
          <FlipVertical2 className="size-4" />
        </IconBtn>
      </div>
      <Slider label="Zoom" value={zoom} min={1} max={4} step={0.01} onChange={onZoomChange} />
      <Slider
        label="Straighten"
        value={straighten}
        min={-45}
        max={45}
        step={0.5}
        onChange={onStraightenChange}
        formatValue={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}°`}
      />
    </div>
  );
}

function FilterPanel({
  src,
  cssFilter,
  active,
  onPick,
}: {
  src: string | null;
  cssFilter: string;
  active: string;
  onPick: (k: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-medium text-slate-500">Tap to apply</p>
      <div className="grid grid-cols-3 gap-2.5">
        {FILTER_PRESETS.map((preset) => {
          const isActive = preset.key === active;
          // Live thumbnail by re-applying the preset (not the live combined
          // filter) so thumbs read consistently regardless of brightness etc.
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => onPick(preset.key)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border bg-white p-1.5 transition",
                isActive ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200 hover:border-slate-300",
              )}
            >
              {src ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="aspect-square w-full rounded object-cover"
                  style={{ filter: preset.key === active ? cssFilter : preset.filter }}
                />
              ) : (
                <div className="aspect-square w-full rounded bg-slate-200" />
              )}
              <span className="text-[11px] font-semibold text-slate-700">{preset.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AdjustPanel({
  brightness,
  contrast,
  saturation,
  onBrightnessChange,
  onContrastChange,
  onSaturationChange,
}: {
  brightness: number;
  contrast: number;
  saturation: number;
  onBrightnessChange: (v: number) => void;
  onContrastChange: (v: number) => void;
  onSaturationChange: (v: number) => void;
}) {
  return (
    <div className="space-y-5">
      <Slider
        label="Brightness"
        value={brightness}
        min={50}
        max={150}
        step={1}
        onChange={onBrightnessChange}
        formatValue={(v) => `${v}%`}
      />
      <Slider
        label="Contrast"
        value={contrast}
        min={50}
        max={150}
        step={1}
        onChange={onContrastChange}
        formatValue={(v) => `${v}%`}
      />
      <Slider
        label="Saturation"
        value={saturation}
        min={0}
        max={200}
        step={1}
        onChange={onSaturationChange}
        formatValue={(v) => `${v}%`}
      />
    </div>
  );
}

// ─── Bits ──────────────────────────────────────────────────────────────────

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  const onInput = (e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value));
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[12px] font-semibold text-slate-700">
        <span>{label}</span>
        <span className="text-[11.5px] font-medium tabular-nums text-slate-500">
          {formatValue ? formatValue(value) : value}
        </span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onInput}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
      />
    </label>
  );
}

// ─── Canvas bake ───────────────────────────────────────────────────────────

/**
 * Apply rotation + flips + filter to the source image and crop to `area`.
 *
 * Why the intermediate rotated canvas: drawing a rotated/flipped image
 * directly with `drawImage` requires the destination canvas to be sized to
 * the rotated bounding box, which then has to be cropped. A staged approach
 * (rotate into a same-size canvas, then crop) is simpler and avoids
 * subpixel drift between preview and bake.
 */
async function renderCroppedBlob(args: {
  src: string;
  area: Area;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  cssFilter: string;
}): Promise<Blob> {
  const img = await loadImage(args.src);
  const { rotation, flipH, flipV, area, cssFilter } = args;

  // Rotate + flip onto a canvas sized to the rotated bounding box so the
  // crop math from react-easy-crop maps 1:1.
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const bboxW = img.width * cos + img.height * sin;
  const bboxH = img.width * sin + img.height * cos;
  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = Math.round(bboxW);
  rotatedCanvas.height = Math.round(bboxH);
  const rctx = rotatedCanvas.getContext("2d");
  if (!rctx) throw new Error("Canvas unavailable");
  rctx.translate(bboxW / 2, bboxH / 2);
  rctx.rotate(radians);
  rctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  rctx.drawImage(img, -img.width / 2, -img.height / 2);

  // Now crop the rotated canvas to the requested area, applying the live
  // CSS filter so the bake matches the preview.
  const out = document.createElement("canvas");
  out.width = OUTPUT_SIZE;
  out.height = OUTPUT_SIZE;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("Canvas unavailable");
  octx.fillStyle = "#ffffff"; // JPEG has no alpha — flatten transparent pixels to white
  octx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  octx.filter = cssFilter || "none";
  octx.drawImage(
    rotatedCanvas,
    area.x, area.y, area.width, area.height,
    0, 0, OUTPUT_SIZE, OUTPUT_SIZE,
  );

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

// ─── File-picker helper (used by the caller) ───────────────────────────────

/**
 * Read a file from a hidden <input> into a data URL the dialog can render.
 * Centralized here so the caller doesn't need to know about FileReader.
 */
export async function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

/** Hidden file input the caller mounts once and triggers programmatically. */
export function useImageFilePicker(onPicked: (file: File) => void) {
  const ref = useRef<HTMLInputElement | null>(null);
  const trigger = useCallback(() => ref.current?.click(), []);
  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onPicked(file);
      // Reset so picking the same file twice still fires onChange.
      if (ref.current) ref.current.value = "";
    },
    [onPicked],
  );
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      className="hidden"
      onChange={onChange}
    />
  );
  return { input, trigger };
}
