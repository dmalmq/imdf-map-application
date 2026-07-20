import { useEffect } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { LocaleCode, ViewerLevel } from "../imdf/types";
import type { IssueFilter, IssueStatus, ReviewIssue } from "../issues/types";
import { filterIssues, issueStatusLabel, issueSummary } from "../issues/IssueQueue";
import { ordinalOfLevel } from "../state/floorGroups";

/** Overlay container class hosting all issue pins (separate from Labels markers). */
export const ISSUE_PIN_OVERLAY_CLASS = "issue-pin-overlay";
/** Base class for a DOM issue pin button (styled by App CSS in a later task). */
export const ISSUE_PIN_CLASS = "issue-pin";
/** Selected variant, combined with ISSUE_PIN_CLASS. */
export const ISSUE_PIN_SELECTED_CLASS = "issue-pin--selected";

const ISSUE_LABEL = { ja: "課題", en: "Issue" } as const;

export interface MapIssuePin {
  id: string;
  pinNumber: number;
  levelId: string;
  longitude: number;
  latitude: number;
  summary: string;
  status: IssueStatus;
}

/**
 * Projects the canonical issue list to the pins for one floor and panel
 * filter, in deterministic pin-number order. Closed and deleted roots are
 * hidden by every filter except `closed`, mirroring the queue.
 */
export function projectPins(
  issues: ReviewIssue[],
  levelIds: readonly string[],
  filter: IssueFilter,
  currentUserId: number | null = null,
  locale: LocaleCode = "en",
): MapIssuePin[] {
  return filterIssues(issues, filter, currentUserId)
    .filter((issue) => levelIds.includes(issue.anchor.levelId))
    .map((issue) => ({
      id: issue.id,
      pinNumber: issue.pinNumber,
      levelId: issue.anchor.levelId,
      longitude: issue.anchor.longitude,
      latitude: issue.anchor.latitude,
      summary: issueSummary(issue.bodyMarkdown, locale),
      status: issue.status,
    }))
    .sort((a, b) => a.pinNumber - b.pinNumber);
}

export interface UseIssuePinsArgs {
  map: MapLibreMap | null;
  levelId: string;
  pins: MapIssuePin[];
  selectedIssueId: string | null;
  locale: LocaleCode;
  /** Venue levels, used to localize the floor context in each pin's name. */
  levels: ViewerLevel[];
  /** Stable callback; pin click opens the matching issue. */
  onSelect: (issueId: string) => void;
}

function pinAriaLabel(pin: MapIssuePin, locale: LocaleCode, floor: string): string {
  return `${ISSUE_LABEL[locale]} #${pin.pinNumber}: ${pin.summary} — ${issueStatusLabel(pin.status, locale)} — ${floor}`;
}

/**
 * DOM issue-pin overlay for the current floor. Pins are absolutely-positioned
 * buttons in a plain overlay div, placed with an integral 2D translate from
 * `map.project` (mirroring the feature-marker overlay for stable rasterization
 * and cheap camera-move repositioning). The overlay is independent of the
 * Labels layer group: it renders whenever pins exist. Selecting a pin opens
 * its issue; the click never propagates to the map so it cannot double as an
 * ordinary feature selection or placement click.
 */
export function useIssuePins({
  map,
  levelId,
  pins,
  selectedIssueId,
  locale,
  levels,
  onSelect,
}: UseIssuePinsArgs): void {
  useEffect(() => {
    if (map == null) {
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = ISSUE_PIN_OVERLAY_CLASS;
    map.getContainer().appendChild(overlay);

    interface PositionedPin {
      el: HTMLButtonElement;
      lngLat: [number, number];
      width: number;
      height: number;
    }
    const positioned: PositionedPin[] = [];

    const reposition = (): void => {
      for (const item of positioned) {
        const point = map.project(item.lngLat);
        const x = Math.round(point.x - item.width / 2);
        const y = Math.round(point.y - item.height);
        item.el.style.transform = `translate(${x}px, ${y}px)`;
      }
    };

    const levelsById = new Map(levels.map((level) => [level.id, level]));
    const floorLabelFor = (id: string): string => {
      const level = levelsById.get(id);
      if (level == null) {
        return id;
      }
      return level.label[locale] ?? level.shortName[locale] ?? Object.values(level.label)[0] ?? id;
    };

    const selectedOrdinal = ordinalOfLevel(levels, levelId);
    const floorPins = pins
      .filter((pin) => {
        if (selectedOrdinal === null) {
          return pin.levelId === levelId;
        }
        return (levelsById.get(pin.levelId)?.ordinal ?? null) === selectedOrdinal;
      })
      .slice()
      .sort((a, b) => a.pinNumber - b.pinNumber);

    for (const pin of floorPins) {
      const el = document.createElement("button");
      el.type = "button";
      const selected = pin.id === selectedIssueId;
      const classes = [ISSUE_PIN_CLASS];
      if (selected) {
        classes.push(ISSUE_PIN_SELECTED_CLASS);
      }
      el.className = classes.join(" ");
      el.textContent = String(pin.pinNumber);
      el.setAttribute("aria-label", pinAriaLabel(pin, locale, floorLabelFor(pin.levelId)));
      el.setAttribute("aria-pressed", selected ? "true" : "false");
      el.dataset.issueId = pin.id;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect(pin.id);
      });

      overlay.appendChild(el);

      const rect = el.getBoundingClientRect();
      positioned.push({
        el,
        lngLat: [pin.longitude, pin.latitude],
        width: rect.width,
        height: rect.height,
      });
    }

    reposition();

    map.on("move", reposition);
    map.on("moveend", reposition);
    map.on("resize", reposition);

    return () => {
      map.off("move", reposition);
      map.off("moveend", reposition);
      map.off("resize", reposition);
      overlay.remove();
    };
  }, [map, levelId, pins, selectedIssueId, locale, levels, onSelect]);
}
