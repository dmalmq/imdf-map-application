import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  checkIssueBody,
  MarkdownBody,
  normalizeIssueMarkdown,
  safeIssueUrl,
} from "./MarkdownBody";

function renderBody(body: string): HTMLElement {
  return render(<MarkdownBody body={body} />).container;
}

describe("MarkdownBody rendering", () => {
  it("renders paragraphs with emphasis, strong, and inline code", () => {
    const container = renderBody("First *em* and **strong** with `code`.");
    expect(container.querySelector("p")?.textContent).toContain("First");
    expect(container.querySelector("em")?.textContent).toBe("em");
    expect(container.querySelector("strong")?.textContent).toBe("strong");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("converts single newlines to line breaks", () => {
    const container = renderBody("line one\nline two");
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("renders ordered and unordered lists", () => {
    const container = renderBody("1. first\n2. second\n\n- a\n- b");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
  });

  it("renders safe links with external-link attributes", () => {
    renderBody("[docs](https://example.com/docs)");
    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps mailto links", () => {
    renderBody("[mail](mailto:review@example.com)");
    expect(screen.getByRole("link", { name: "mail" }).getAttribute("href")).toBe(
      "mailto:review@example.com",
    );
  });

  it("drops raw HTML blocks instead of rendering them", () => {
    const container = renderBody("before\n\n<script>alert(1)</script>\n\nafter");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("alert");
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });

  it("drops inline HTML tags but keeps the surrounding text", () => {
    const container = renderBody("some <b>bold</b> text");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("bold");
  });

  it("renders no headings, images, tables, or embedded media", () => {
    const container = renderBody(
      "# Title\n\n![alt](https://example.com/x.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<iframe src=\"https://example.com\"></iframe>",
    );
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,foo",
    "/relative/path",
    "./rel",
    "//protocol-relative.example.com",
    "ftp://example.com/file",
  ])("renders the %s link without an href", (href) => {
    const container = renderBody(`[click](${href})`);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBeNull();
    expect(anchor?.textContent).toBe("click");
  });

  it("blocks entity-encoded javascript: links", () => {
    const container = renderBody("[click](jav&#x61;script:alert(1))");
    expect(container.querySelector("a")?.getAttribute("href")).toBeNull();
  });
});

describe("safeIssueUrl", () => {
  it.each([
    "https://example.com",
    "http://example.com/x?y=1#z",
    "HTTPS://EXAMPLE.COM",
    "mailto:a@b.co",
  ])("allows %s", (url) => {
    expect(safeIssueUrl(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "file:///etc/passwd",
    "ftp://example.com",
    "/rel",
    "docs/page",
    "//evil.com",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(safeIssueUrl(url)).toBeUndefined();
  });
});

describe("normalizeIssueMarkdown", () => {
  it("converts CRLF and bare CR to LF, mirroring the server", () => {
    expect(normalizeIssueMarkdown("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("performs no other transformation", () => {
    expect(normalizeIssueMarkdown("  spaced  \n\ttabbed ")).toBe("  spaced  \n\ttabbed ");
  });
});

describe("checkIssueBody", () => {
  it("counts Unicode scalar values, not UTF-16 units", () => {
    expect(checkIssueBody("🙂🙂").scalars).toBe(2);
    expect(checkIssueBody("é").scalars).toBe(2);
  });

  it("accepts tab and LF as the only permitted control characters", () => {
    expect(checkIssueBody("a\tb\nc").problem).toBeNull();
  });

  it.each(["", "   ", " \n\t "])("flags the whitespace-only body %j as empty", (body) => {
    expect(checkIssueBody(body).problem).toBe("empty");
  });

  it("preserves leading and trailing whitespace in an otherwise non-empty body", () => {
    expect(checkIssueBody("  padded  ").problem).toBeNull();
  });

  it("accepts exactly 4000 scalars and rejects 4001", () => {
    expect(checkIssueBody("x".repeat(4000)).problem).toBeNull();
    expect(checkIssueBody("x".repeat(4001)).problem).toBe("too_long");
  });

  it("counts astral characters once at the boundary", () => {
    expect(checkIssueBody("🙂".repeat(4000)).problem).toBeNull();
    expect(checkIssueBody("🙂".repeat(4001)).problem).toBe("too_long");
  });

  it.each([0x00, 0x08, 0x0b, 0x1f, 0x7f, 0x85, 0x9f])(
    "flags control character U+%04X",
    (unit) => {
      expect(checkIssueBody(`a${String.fromCharCode(unit)}b`).problem).toBe(
        "control_characters",
      );
    },
  );

  it("flags unpaired surrogates", () => {
    expect(checkIssueBody("a\ud800b").problem).toBe("unpaired_surrogates");
    expect(checkIssueBody("a\udfff").problem).toBe("unpaired_surrogates");
  });

  it("reports the scalar count alongside a problem", () => {
    const check = checkIssueBody("x".repeat(4001));
    expect(check.scalars).toBe(4001);
    expect(check.problem).toBe("too_long");
  });
});
