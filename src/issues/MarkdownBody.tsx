import type { ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import type { LocaleCode } from "../imdf/types";

/**
 * The only Markdown rendering boundary in the app. Raw HTML is never parsed
 * (no rehype-raw, `skipHtml` drops it), only a small allowlist of elements
 * renders, and every link URL passes the http/https/mailto protocol filter
 * before reaching the DOM.
 */

export const ISSUE_MARKDOWN_MAX_SCALARS = 4000;

/** Converts CRLF and bare CR to LF — the exact server normalization. */
export function normalizeIssueMarkdown(input: string): string {
  return input.replace(/\r\n?/g, "\n");
}

export type IssueBodyProblem =
  | "empty"
  | "too_long"
  | "control_characters"
  | "unpaired_surrogates";

export interface IssueBodyCheck {
  /** Unicode scalar values in the normalized body. */
  scalars: number;
  problem: IssueBodyProblem | null;
}

/**
 * Mirrors the server Markdown contract for immediate composer feedback (the
 * server remains authoritative): 1–4,000 Unicode scalar values after newline
 * normalization, no unpaired UTF-16 surrogates, not whitespace-only, and no
 * C0/C1 controls except tab and LF.
 */
export function checkIssueBody(normalized: string): IssueBodyCheck {
  let scalars = 0;
  let whitespaceOnly = true;
  let problem: IssueBodyProblem | null = null;
  for (let i = 0; i < normalized.length; i += 1) {
    const unit = normalized.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = i + 1 < normalized.length ? normalized.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        problem ??= "unpaired_surrogates";
      } else {
        i += 1;
        scalars += 1;
        whitespaceOnly = false;
      }
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      problem ??= "unpaired_surrogates";
      continue;
    }
    if ((unit <= 0x1f && unit !== 0x09 && unit !== 0x0a) || (unit >= 0x7f && unit <= 0x9f)) {
      problem ??= "control_characters";
      continue;
    }
    scalars += 1;
    if (!/\s/.test(normalized[i] as string)) {
      whitespaceOnly = false;
    }
  }
  if (problem === null) {
    if (whitespaceOnly || scalars === 0) {
      problem = "empty";
    } else if (scalars > ISSUE_MARKDOWN_MAX_SCALARS) {
      problem = "too_long";
    }
  }
  return { scalars, problem };
}

/**
 * Link protocol filter: only absolute `http:`, `https:`, and `mailto:` URLs
 * keep an href. Relative URLs, protocol-relative URLs, and every other
 * scheme (javascript:, data:, …) return `undefined`, which removes the
 * attribute from the rendered anchor.
 */
export function safeIssueUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return url;
    }
  } catch {
    // Relative or malformed input carries no safe protocol.
  }
  return undefined;
}

export interface MarkdownBodyProps {
  /** Normalized Markdown source as stored on the server. */
  body: string;
}

export function MarkdownBody({ body }: MarkdownBodyProps): ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBreaks]}
      allowedElements={["p", "br", "em", "strong", "ol", "ul", "li", "a", "code"]}
      skipHtml
      urlTransform={safeIssueUrl}
      components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      }}
    >
      {body}
    </ReactMarkdown>
  );
}

const editorUi = {
  hint: {
    ja: "Markdown：**太字**、*斜体*、リスト、リンクが使えます",
    en: "Markdown: **bold**, *italic*, lists, links",
  },
  empty: { ja: "本文を入力してください", en: "Enter some text." },
  tooLong: { ja: "4,000文字以内で入力してください", en: "Keep it under 4,000 characters." },
  controlCharacters: {
    ja: "使用できない制御文字が含まれています",
    en: "Remove unsupported control characters.",
  },
  brokenCharacters: {
    ja: "不正な文字が含まれています",
    en: "The text contains broken characters.",
  },
} as const;

export interface MarkdownEditorFeedbackProps {
  locale: LocaleCode;
  /** `checkIssueBody` result for the editor's normalized value. */
  check: IssueBodyCheck;
}

/**
 * Shared feedback block for every Markdown editor (issue composer, root and
 * reply editors, reply box): formatting hint, live scalar count, and the
 * reason a disabled submit cannot proceed — validation problems as
 * `role="alert"`, the empty state as a quiet note.
 */
export function MarkdownEditorFeedback({ locale, check }: MarkdownEditorFeedbackProps): ReactElement {
  return (
    <>
      <div className="markdown-editor__hint-row">
        <p className="markdown-editor__hint">{editorUi.hint[locale]}</p>
        <p className="markdown-editor__count" aria-live="polite">
          {`${check.scalars}/${ISSUE_MARKDOWN_MAX_SCALARS}`}
        </p>
      </div>
      {check.problem === "empty" ? (
        <p className="markdown-editor__note">{editorUi.empty[locale]}</p>
      ) : null}
      {check.problem === "too_long" ? (
        <p className="markdown-editor__error" role="alert">
          {editorUi.tooLong[locale]}
        </p>
      ) : null}
      {check.problem === "control_characters" ? (
        <p className="markdown-editor__error" role="alert">
          {editorUi.controlCharacters[locale]}
        </p>
      ) : null}
      {check.problem === "unpaired_surrogates" ? (
        <p className="markdown-editor__error" role="alert">
          {editorUi.brokenCharacters[locale]}
        </p>
      ) : null}
    </>
  );
}
