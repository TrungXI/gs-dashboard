// Animated loading spinner — a rotating ring, dark-theme friendly.

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Đang tải"
      className={`inline-block animate-spin rounded-full border-2 border-[#333] border-t-[#17a2b8] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Centered spinner with optional label — for full-panel loading states. */
export function LoadingState({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-16 text-[#666] text-[13px] ${className}`}>
      <Spinner size={24} />
      {label && <span>{label}</span>}
    </div>
  );
}
