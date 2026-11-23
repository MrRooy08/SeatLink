import type { ReactNode } from 'react'
import './Icon.css'

const paths = {
  checkout: <><path d="M3 5h18v14H3zM3 9h18M7 13h4M7 16h7" /></>,
  store: <><path d="m3 8 2-5h14l2 5v3a3 3 0 0 1-4 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-4-2zM5 14v7h14v-7M10 21v-6h4v6M3 8h18" /></>,
  seats: <><path d="M6 4v9h12V4M4 10v7h16v-7M6 17v4M18 17v4M9 4h6" /></>,
  person: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  history: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" /></>,
  display: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  cart: <><path d="M2 3h3l3 12h11l3-8H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
  qr: <><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h4v4h-6zM12 3v9h9M3 12h6M12 16v5" /></>,
  cash: <><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M5 9v6M19 9v6" /></>,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M9 2h6M12 5V2M12 9v5l3 2" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></>,
  warning: <><path d="M12 3 2 21h20zM12 9v5M12 17v1" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="m8 8 8 8M16 8l-8 8" /></>,
  food: <><path d="M3 3v6c0 3 6 3 6 0V3M6 3v19M18 22V3c-5 3-5 10 0 10" /></>,
  tools: <><path d="m14 6 4 4-9 10-5-5zM14 6V3l7 7h-3" /></>,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof paths
export default function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}
