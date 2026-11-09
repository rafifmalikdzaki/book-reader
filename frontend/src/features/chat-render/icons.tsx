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
