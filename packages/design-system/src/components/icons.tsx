import type { ReactNode } from 'react';

// Small inline icons, so the overlay components need no icon dependency.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const CheckIcon = () => (
  <Icon>
    <path d="M3 8.5l3.5 3.5L13 4.5" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon>
    <path d="M4 6l4 4 4-4" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);
