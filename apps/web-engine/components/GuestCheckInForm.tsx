"use client";

import { useRef, useState } from "react";

interface GuestCheckInFormProps {
  token: string;
}

function getPointerPosition(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function GuestCheckInForm({ token }: GuestCheckInFormProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const [fullName, setFullName] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    isDrawingRef.current = true;
    const { x, y } = getPointerPosition(canvas, event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !isDrawingRef.current) return;
    const { x, y } = getPointerPosition(canvas, event);
    ctx.strokeStyle = "#171717";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  }

  function handlePointerUp() {
    isDrawingRef.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  async function submit() {
    const canvas = canvasRef.current;
    if (!canvas || !fullName.trim() || !hasSignature) return;

    setStatus("submitting");
    setError(null);
    try {
      const apiServerUrl = process.env.NEXT_PUBLIC_API_SERVER_URL ?? "http://localhost:4000";
      const response = await fetch(`${apiServerUrl}/api/v1/public/guest/${encodeURIComponent(token)}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, signatureDataUrl: canvas.toDataURL("image/png") }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Failed to submit check-in");
      }

      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit check-in");
      setStatus("error");
    }
  }

  if (status === "done") {
    return <p className="mt-2 text-sm text-green-700">Thanks — your check-in is complete.</p>;
  }

  return (
    <div className="mt-3 space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <label className="block text-xs text-neutral-500">Full name</label>
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Jane Doe"
          className="w-full rounded-md border border-neutral-300 p-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-xs text-neutral-500">Signature</label>
        <canvas
          ref={canvasRef}
          width={320}
          height={120}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="w-full touch-none rounded-md border border-neutral-300 bg-white"
        />
        <button type="button" onClick={clearSignature} className="mt-1 text-xs text-neutral-500 underline">
          Clear
        </button>
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!fullName.trim() || !hasSignature || status === "submitting"}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === "submitting" ? "Submitting..." : "Submit check-in"}
      </button>
    </div>
  );
}
