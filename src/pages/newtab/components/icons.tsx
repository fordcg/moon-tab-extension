interface IconProps {
  className?: string;
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h14" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function SaveIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M5 5h11l3 3v11H5z" />
      <path d="M8 5v6h8" />
      <path d="M8 19v-5h8v5" />
    </svg>
  );
}
