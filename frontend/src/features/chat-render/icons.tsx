import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  };
}

/** Reasoning/thinking trace marker (replaces the 💡 glyph). */
export function BulbIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 1.8a4.2 4.2 0 0 0-2.4 7.65c.5.36.83.92.95 1.55h2.9c.12-.63.45-1.19.95-1.55A4.2 4.2 0 0 0 8 1.8Z" />
      <path d="M6.6 13h2.8" />
      <path d="M7.2 14.8h1.6" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.2 8 10l4-3.8" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m3.2 8.6 3.1 3L12.8 4.4" />
    </svg>
  );
}

/** Live "running" marker. */
export function PulseDotIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, stroke: 'none', fill: 'currentColor' })}>
      <circle cx="8" cy="8" r="3.4" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 13V3.4" />
      <path d="M3.8 7.2 8 3l4.2 4.2" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, stroke: 'none', fill: 'currentColor' })}>
      <rect x="4" y="4" width="8" height="8" rx="1.4" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.8 4 6 8l3.8 4" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.2 4 10 8l-3.8 4" />
    </svg>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 9.8 8 6l4 3.8" />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 8h9" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 8h9M8 3.5v9" />
    </svg>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13.2 2.6v3h-3" />
    </svg>
  );
}

export function FullscreenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.8 6V2.8H6M10 2.8h3.2V6M13.2 10v3.2H10M6 13.2H2.8V10" />
    </svg>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.5 3.5h-3v9h9v-3" />
      <path d="M9.5 3h3.5v3.5M13 3 7.5 8.5" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function SinglePageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4.5" y="2.5" width="7" height="11" rx="1" />
    </svg>
  );
}

export function TwoPageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3.5v10M8 3.5C6.6 2.7 4.6 2.5 2.5 2.8v10c2.1-.3 4.1-.1 5.5.7 1.4-.8 3.4-1 5.5-.7v-10C11.4 2.5 9.4 2.7 8 3.5Z" />
    </svg>
  );
}
