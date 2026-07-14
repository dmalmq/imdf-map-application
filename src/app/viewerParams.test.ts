import { describe, expect, it } from "vitest";
import { parseViewerParams } from "./viewerParams";

const BASE = "https://viewer.test/";

describe("parseViewerParams", () => {
  it("accepts absolute http(s) src verbatim", () => {
    expect(parseViewerParams("?src=https://cdn.example.com/venue.zip", BASE).src).toBe(
      "https://cdn.example.com/venue.zip",
    );
    expect(parseViewerParams("?src=http://cdn.example.com/venue.zip", BASE).src).toBe(
      "http://cdn.example.com/venue.zip",
    );
  });

  it("accepts relative src paths resolved against the base", () => {
    expect(parseViewerParams("?src=/venues/tokyo.zip", BASE).src).toBe("/venues/tokyo.zip");
    expect(parseViewerParams("?src=venues/tokyo.zip", BASE).src).toBe("venues/tokyo.zip");
  });

  it("rejects non-http(s) schemes and malformed URLs", () => {
    expect(parseViewerParams("?src=javascript:alert(1)", BASE).src).toBeNull();
    expect(parseViewerParams("?src=data:application/zip;base64,AAAA", BASE).src).toBeNull();
    expect(parseViewerParams("?src=http://", BASE).src).toBeNull();
    expect(parseViewerParams("", BASE).src).toBeNull();
  });

  it("trims level and treats empty as absent", () => {
    expect(parseViewerParams("?level=%20b1f%20", BASE).level).toBe("b1f");
    expect(parseViewerParams("?level=", BASE).level).toBeNull();
    expect(parseViewerParams("?level=%20%20", BASE).level).toBeNull();
    expect(parseViewerParams("", BASE).level).toBeNull();
  });

  it("parses embed truthy forms and rejects others", () => {
    expect(parseViewerParams("?embed", BASE).embed).toBe(true);
    expect(parseViewerParams("?embed=1", BASE).embed).toBe(true);
    expect(parseViewerParams("?embed=true", BASE).embed).toBe(true);
    expect(parseViewerParams("?embed=TRUE", BASE).embed).toBe(true);
    expect(parseViewerParams("?embed=0", BASE).embed).toBe(false);
    expect(parseViewerParams("?embed=yes", BASE).embed).toBe(false);
    expect(parseViewerParams("", BASE).embed).toBe(false);
  });

  it("whitelists lang", () => {
    expect(parseViewerParams("?lang=ja", BASE).locale).toBe("ja");
    expect(parseViewerParams("?lang=en", BASE).locale).toBe("en");
    expect(parseViewerParams("?lang=fr", BASE).locale).toBeNull();
    expect(parseViewerParams("", BASE).locale).toBeNull();
  });

  it("whitelists theme, ignoring prototype keys", () => {
    expect(parseViewerParams("?theme=customer-blue", BASE).themeId).toBe("customer-blue");
    expect(parseViewerParams("?theme=tokyo-green", BASE).themeId).toBe("tokyo-green");
    expect(parseViewerParams("?theme=neon", BASE).themeId).toBeNull();
    expect(parseViewerParams("?theme=toString", BASE).themeId).toBeNull();
    expect(parseViewerParams("?theme=__proto__", BASE).themeId).toBeNull();
  });
});
