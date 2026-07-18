import type { ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";

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
