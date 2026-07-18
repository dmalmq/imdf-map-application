import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const createVenue = vi.fn();
const uploadVersion = vi.fn();
const waitForJob = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createVenue: (...a: unknown[]) => createVenue(...a),
      uploadVersion: (...a: unknown[]) => uploadVersion(...a),
      waitForJob: (...a: unknown[]) => waitForJob(...a),
    },
  };
});

import { UploadModal } from "./UploadModal";

afterEach(() => {
  vi.clearAllMocks();
});

function zipFile(name = "shinjuku-station.zip"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, { type: "application/zip" });
}

describe("UploadModal", () => {
  it("prefills the name from the file, uploads, and reaches the done state", async () => {
    createVenue.mockResolvedValue({ id: 7, slug: "shinjuku-station", name: "shinjuku-station" });
    uploadVersion.mockResolvedValue({ jobId: "j1" });
    waitForJob.mockResolvedValue({ status: "done" });
    const onPublished = vi.fn();
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={onPublished} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile());
    expect((screen.getByLabelText("Dataset name") as HTMLInputElement).value).toBe(
      "shinjuku-station",
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(screen.getByText("Published")).toBeTruthy();
    });
    expect(createVenue).toHaveBeenCalledWith("shinjuku-station");
    expect(uploadVersion).toHaveBeenCalled();
    expect(onPublished).toHaveBeenCalled();
    const open = screen.getByRole("link", { name: "Open" });
    expect(open.getAttribute("href")).toBe("/?dataset=shinjuku-station");
  });

  it("surfaces a failed publish job and re-enables the form", async () => {
    createVenue.mockResolvedValue({ id: 8, slug: "bad", name: "bad" });
    uploadVersion.mockResolvedValue({ jobId: "j2" });
    waitForJob.mockResolvedValue({ status: "error", error: "not a ZIP archive" });
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={() => {}} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("bad.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText(/not a ZIP archive/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });
  it("renders corrective copy instead of raw structured JSON for a failed publish job", async () => {
    createVenue.mockResolvedValue({ id: 10, slug: "bad-imdf", name: "bad-imdf" });
    uploadVersion.mockResolvedValue({ jobId: "j3" });
    waitForJob.mockResolvedValue({
      status: "error",
      error: JSON.stringify({
        code: "missing_required_file",
        message: "importer: manifest.json is missing from the archive root",
        details: { entry: "manifest.json" },
      }),
    });
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={() => {}} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("bad-imdf.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("missing a required IMDF file");
    expect(alert.textContent).not.toContain("{");
    expect(alert.textContent).not.toContain("manifest.json");
    expect(alert.textContent).not.toContain("missing_required_file");
  });

  it("hides internal structured error messages behind generic corrective copy", async () => {
    createVenue.mockResolvedValue({ id: 11, slug: "crash", name: "crash" });
    uploadVersion.mockResolvedValue({ jobId: "j4" });
    waitForJob.mockResolvedValue({
      status: "error",
      error: JSON.stringify({
        code: "internal_error",
        message: "SQLITE_BUSY: database is locked at /var/lib/kiriko/data.db",
      }),
    });
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={() => {}} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("crash.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("SQLITE_BUSY");
    expect(alert.textContent).not.toContain("{");
    expect(alert.textContent?.length).toBeGreaterThan(0);
  });

  it("never renders malformed JSON job errors verbatim", async () => {
    createVenue.mockResolvedValue({ id: 12, slug: "weird", name: "weird" });
    uploadVersion.mockResolvedValue({ jobId: "j5" });
    waitForJob.mockResolvedValue({
      status: "error",
      error: '{"unexpected":true,"stack":["a","b"]}',
    });
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={() => {}} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("weird.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("{");
    expect(alert.textContent).not.toContain("unexpected");
    expect(alert.textContent?.length).toBeGreaterThan(0);
  });

  it("disables the header close button while uploading", async () => {
    createVenue.mockResolvedValue({ id: 9, slug: "slow", name: "slow" });
    uploadVersion.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={() => {}} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("slow.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });
  });
});
