import type { LocaleCode } from "../imdf/types";
import { themes } from "../theme/presets";
import type { ThemeId } from "../theme/types";

export interface ViewerParams {
  src: string | null;
  level: string | null;
  embed: boolean;
  locale: LocaleCode | null;
  themeId: ThemeId | null;
}

function safeSrc(raw: string | null, base?: string): string | null {
  if (raw === null || raw === "") {
    return null;
  }
  try {
    const url = new URL(raw, base ?? window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/** Parses the viewer's deep-link query params; invalid values degrade to absent. */
export function parseViewerParams(search: string, base?: string): ViewerParams {
  const params = new URLSearchParams(search);

  const levelRaw = params.get("level");
  const level = levelRaw !== null && levelRaw.trim() !== "" ? levelRaw.trim() : null;

  const embedRaw = params.get("embed");
  const embed =
    embedRaw !== null && (embedRaw === "" || /^(1|true)$/i.test(embedRaw));

  const langRaw = params.get("lang");
  const locale: LocaleCode | null = langRaw === "ja" || langRaw === "en" ? langRaw : null;

  const themeRaw = params.get("theme");
  const themeId: ThemeId | null =
    themeRaw !== null && Object.hasOwn(themes, themeRaw) ? (themeRaw as ThemeId) : null;

  return { src: safeSrc(params.get("src"), base), level, embed, locale, themeId };
}
