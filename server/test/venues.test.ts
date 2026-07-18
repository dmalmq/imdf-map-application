import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

afterEach(cleanupTestApps);

describe("venues", () => {
  it("requires a session", async () => {
    const { app } = await makeTestApp();
    const list = await app.inject({ method: "GET", url: "/api/venues" });
    expect(list.statusCode).toBe(401);
    const create = await app.inject({
      method: "POST",
      url: "/api/venues",
      payload: { name: "No Session" },
    });
    expect(create.statusCode).toBe(401);
    const del = await app.inject({ method: "DELETE", url: "/api/venues/1" });
    expect(del.statusCode).toBe(401);
  });

  it("creates with slugs, lists, and deletes", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/venues",
      headers: { cookie },
      payload: { name: "Shinjuku Station 構内図" },
    });
    expect(created.statusCode).toBe(201);
    const venue = created.json().venue;
    expect(venue.slug).toBe("shinjuku-station");

    // Same name → suffixed slug, not a 500.
    const again = await app.inject({
      method: "POST",
      url: "/api/venues",
      headers: { cookie },
      payload: { name: "Shinjuku Station" },
    });
    expect(again.json().venue.slug).toBe("shinjuku-station-2");

    const list = await app.inject({ method: "GET", url: "/api/venues", headers: { cookie } });
    expect(list.json().venues).toHaveLength(2);
    expect(list.json().venues[0].latest).toBeNull();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/venues/${venue.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const afterDelete = await app.inject({ method: "GET", url: "/api/venues", headers: { cookie } });
    expect(afterDelete.json().venues).toHaveLength(1);

    const missing = await app.inject({
      method: "DELETE",
      url: `/api/venues/${venue.id}`,
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});
