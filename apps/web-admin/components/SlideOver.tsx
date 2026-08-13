"use client";

import { X } from "lucide-react";

interface SlideOverProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function SlideOver({ title, onClose, children }: SlideOverProps) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-96 overflow-y-auto border-l border-neutral-200 bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
