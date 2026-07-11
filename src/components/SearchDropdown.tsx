'use client';

import { useEffect, useRef, useState } from 'react';

interface Option {
  value: string;
  label: string;
}

interface Props {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}

export default function SearchDropdown({
  options,
  value,
  onChange,
  placeholder,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected ? selected.label : placeholder;

  const filtered = query
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase()),
      )
    : options;

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="relative" ref={rootRef}>
      <div
        className="flex cursor-pointer items-center justify-between rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white transition-colors hover:bg-white/[.12]"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{label}</span>
        <span className="ml-1.5 flex-shrink-0 text-[10px] text-white/40">
          {open ? '▴' : '▾'}
        </span>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-white/15 bg-[#252547] shadow-lg">
          <input
            ref={inputRef}
            className="w-full bg-transparent px-3 py-2 text-xs text-white placeholder:text-white/35 focus:outline-none"
            value={query}
            placeholder="🔍 Tìm..."
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="max-h-56 overflow-y-auto">
            {filtered.map((o) => (
              <div
                key={o.value}
                className={`cursor-pointer px-3 py-2 text-xs transition-colors ${
                  o.value === value
                    ? 'bg-[#17a2b8] text-white'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`}
                onClick={() => pick(o.value)}
              >
                {o.label}
              </div>
            ))}
            {!filtered.length && (
              <div className="px-3 py-2.5 text-xs text-white/35">
                Không tìm thấy
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
