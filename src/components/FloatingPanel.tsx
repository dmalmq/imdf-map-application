import type { ReactNode } from "react";
import { IconClose } from "./icons";

export interface FloatingPanelProps {
  title: string;
  /** Accessible label for the close button. */
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra class on the panel root (placement variants). */
  className?: string;
  /** aria-label falls back to title. */
  ariaLabel?: string;
}

/**
 * Kiriko FloatingPanel: white card floating above the map (Elevation/Floating),
 * Title/18 header with trailing close. Becomes a bottom sheet on compact
 * layouts via CSS.
 */
export function FloatingPanel({
  title,
  closeLabel,
  onClose,
  children,
  className,
  ariaLabel,
}: FloatingPanelProps) {
  return (
    <section
      className={className ? `floating-panel ${className}` : "floating-panel"}
      aria-label={ariaLabel ?? title}
    >
      <div className="floating-panel__handle" aria-hidden="true" />
      <header className="floating-panel__header">
        <h2 className="floating-panel__title">{title}</h2>
        <button type="button" className="floating-panel__close" aria-label={closeLabel} onClick={onClose}>
          <IconClose />
        </button>
      </header>
      <div className="floating-panel__body">{children}</div>
    </section>
  );
}
