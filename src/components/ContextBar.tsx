import { KirikoMark } from "./icons";

export interface ContextBarProps {
  /** Venue (dataset) display name. */
  venueName: string;
  /** Active floor short label, when a venue is loaded. */
  levelName: string | null;
}

/**
 * Kiriko ContextBar: floating top-left wayfinding — mark, dataset name,
 * separator dot, floor.
 */
export function ContextBar({ venueName, levelName }: ContextBarProps) {
  return (
    <div className="context-bar">
      <KirikoMark className="context-bar__mark" />
      <span className="context-bar__name">{venueName}</span>
      {levelName !== null ? (
        <>
          <span className="context-bar__sep" aria-hidden="true" />
          <span className="context-bar__level">{levelName}</span>
        </>
      ) : null}
    </div>
  );
}
