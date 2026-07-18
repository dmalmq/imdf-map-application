import type { ReactElement } from "react";
import type { LocaleCode } from "../imdf/types";
import { IconAlertTriangle, IconLayers, IconMessageSquare, IconSearch } from "./icons";

export type RailPanelId = "search" | "layers" | "issues" | "warnings";

const ui = {
  rail: { ja: "パネル", en: "Panels" },
  search: { ja: "検索", en: "Search" },
  layers: { ja: "レイヤー", en: "Layers" },
  issues: { ja: "課題", en: "Issues" },
  warnings: { ja: "警告", en: "Warnings" },
} as const;

export interface IconRailProps {
  locale: LocaleCode;
  activePanel: RailPanelId | null;
  warningCount: number;
  issuesVisible?: boolean;
  issueCount?: number;
  onToggle: (panel: RailPanelId) => void;
  /** Bottom-bar placement on compact layouts. */
  variant?: "rail" | "bar";
}

interface RailItem {
  id: RailPanelId;
  icon: ReactElement;
  label: string;
  badge?: number;
}

/**
 * Kiriko IconRail: floating cluster of panel toggles — vertical rail on
 * desktop, bottom bar on compact. Active item = Indigo Mist fill.
 */
export function IconRail({
  locale,
  activePanel,
  warningCount,
  issuesVisible = false,
  issueCount = 0,
  onToggle,
  variant = "rail",
}: IconRailProps) {
  const items: RailItem[] = [
    { id: "search", icon: <IconSearch />, label: ui.search[locale] },
    { id: "layers", icon: <IconLayers />, label: ui.layers[locale] },
  ];
  if (issuesVisible) {
    items.push({
      id: "issues",
      icon: <IconMessageSquare />,
      label: ui.issues[locale],
      ...(issueCount > 0 ? { badge: issueCount } : {}),
    });
  }
  if (warningCount > 0) {
    items.push({
      id: "warnings",
      icon: <IconAlertTriangle />,
      label: ui.warnings[locale],
      badge: warningCount,
    });
  }

  return (
    <div
      className={variant === "bar" ? "icon-rail icon-rail--bar" : "icon-rail"}
      role="group"
      aria-label={ui.rail[locale]}
    >
      {items.map((item) => {
        const active = item.id === activePanel;
        return (
          <button
            key={item.id}
            type="button"
            className={active ? "icon-rail__btn icon-rail__btn--active" : "icon-rail__btn"}
            aria-label={item.label}
            aria-pressed={active}
            title={item.label}
            onClick={() => {
              onToggle(item.id);
            }}
          >
            {item.icon}
            {item.badge !== undefined ? (
              <span className="icon-rail__badge" aria-hidden="true">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
