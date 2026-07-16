import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInDialog } from "./SignInDialog";

const loginMock = vi.fn();
const logoutMock = vi.fn(async () => {});

vi.mock("../platform/catalogClient", () => ({
  login: (...args: unknown[]) => loginMock(...args),
  logout: () => logoutMock(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("SignInDialog", () => {
  it("renders nothing while closed", () => {
    render(<SignInDialog open={false} locale="en" onClose={vi.fn()} onSignedIn={vi.fn()} />);
    expect(screen.queryByLabelText("Username")).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("signs in and reports the account", async () => {
    loginMock.mockResolvedValue({ username: "admin", role: "admin" });
    const onSignedIn = vi.fn();
    render(<SignInDialog open locale="en" onClose={vi.fn()} onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith({ username: "admin", role: "admin" });
    });
    expect(loginMock).toHaveBeenCalledWith("admin", "pw", expect.any(AbortSignal));
  });

  it("shows the server message on failure and stays open", async () => {
    loginMock.mockRejectedValue(new Error("Wrong username or password."));
    const onSignedIn = vi.fn();
    render(<SignInDialog open locale="en" onClose={vi.fn()} onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByLabelText("Username"), "x");
    await userEvent.type(screen.getByLabelText("Password"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Wrong username or password.")).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
    // Still open and editable for another attempt.
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("focuses the username input on open and localizes labels", () => {
    render(<SignInDialog open locale="ja" onClose={vi.fn()} onSignedIn={vi.fn()} />);
    const username = screen.getByLabelText("ユーザー名");
    expect(screen.getByLabelText("パスワード")).toBeTruthy();
    expect(screen.getByRole("button", { name: "送信" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeTruthy();
    expect(document.activeElement).toBe(username);
  });

  it("closes via the cancel button and the native cancel (Escape) event", async () => {
    const onClose = vi.fn();
    render(<SignInDialog open locale="en" onClose={onClose} onSignedIn={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    fireEvent(dialog as HTMLElement, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("cancels a pending request without allowing a stale sign-in", async () => {
    let resolveLogin!: (account: { username: string; role: "admin" }) => void;
    loginMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );
    const onClose = vi.fn();
    const onSignedIn = vi.fn();
    render(<SignInDialog open locale="en" onClose={onClose} onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const signal = loginMock.mock.calls[0]?.[2] as AbortSignal;
    expect(signal.aborted).toBe(true);
    resolveLogin({ username: "admin", role: "admin" });
    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
    });
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
