import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewerMenu } from "./ViewerMenu";
import { AccountStatus } from "./AccountStatus";

const baseProps = {
  venueName: "Test Station",
  floorName: "First Floor",
  locale: "en" as const,
  themeId: "tokyo-green" as const,
  showFileControls: true,
  onLocaleChange: () => {},
  onThemeChange: () => {},
  onOpenFile: () => {},
  onOpenGdbArchives: () => {},
  onOpenGdbFolder: () => {},
  onOpenChange: () => {},
};

describe("ViewerMenu", () => {
  it("opens localized venue, floor, locale, and theme controls", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ViewerMenu {...baseProps} />);
    const trigger = screen.getByRole("button", { name: "Menu" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("dialog", { name: "Viewer menu" });
    expect(within(menu).getByText("Test Station")).toBeTruthy();
    expect(menu.querySelector(".viewer-menu__meta span")?.textContent).toBe("First Floor");
    expect(within(menu).getByRole("button", { name: "English" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Customer Blue" })).toBeTruthy();

    rerender(<ViewerMenu {...baseProps} locale="ja" />);
    expect(screen.getByRole("button", { name: "メニュー" })).toBeTruthy();
  });

  it("shows standalone file controls, omits them in embed, and allows host opt-in", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const { rerender } = render(<ViewerMenu {...baseProps} onOpenFile={onOpenFile} />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Open IMDF ZIP" }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);

    rerender(<ViewerMenu {...baseProps} showFileControls={false} onOpenFile={onOpenFile} />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.queryByRole("button", { name: "Open IMDF ZIP" })).toBeNull();

    rerender(<ViewerMenu {...baseProps} showFileControls onOpenFile={onOpenFile} />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("button", { name: "Open IMDF ZIP" })).toBeTruthy();
  });

  it("shows GDB archive/folder controls, gates them by file controls, and hides folder when unsupported", async () => {
    const user = userEvent.setup();
    const onOpenGdbArchives = vi.fn();
    const onOpenGdbFolder = vi.fn();
    const { rerender } = render(
      <ViewerMenu {...baseProps} onOpenGdbArchives={onOpenGdbArchives} onOpenGdbFolder={onOpenGdbFolder} />,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Open GDB archive(s)" }));
    expect(onOpenGdbArchives).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Open GDB folder" }));
    expect(onOpenGdbFolder).toHaveBeenCalledTimes(1);

    // The panel stays open across rerenders, so re-render props reflect live.
    rerender(<ViewerMenu {...baseProps} gdbFolderSupported={false} />);
    expect(screen.getByRole("button", { name: "Open GDB archive(s)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open GDB folder" })).toBeNull();
    expect(screen.getByText(/Zip each \.gdb and use Open GDB archive/i)).toBeTruthy();

    rerender(<ViewerMenu {...baseProps} showFileControls={false} />);
    expect(screen.queryByRole("button", { name: "Open GDB archive(s)" })).toBeNull();
  });

  it("closes on Escape and outside click, restores focus, and reports opening", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ViewerMenu {...baseProps} onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Menu" });

    await user.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await user.keyboard("{Escape}");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("renders the account slot at the bottom of the open menu", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const { rerender } = render(
      <ViewerMenu
        {...baseProps}
        locale="ja"
        accountSlot={
          <AccountStatus account={null} locale="ja" onSignIn={onSignIn} onSignOut={() => {}} />
        }
      />,
    );
    await user.click(screen.getByRole("button", { name: "メニュー" }));

    const panel = screen.getByRole("dialog", { name: "ビューアーメニュー" });
    const signInButton = within(panel).getByRole("button", { name: "サインイン" });
    await user.click(signInButton);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    // The account row is the last block in the menu panel.
    expect(panel.lastElementChild?.className).toBe("viewer-menu__account");
    expect(panel.lastElementChild?.contains(signInButton)).toBe(true);

    const onSignOut = vi.fn();
    rerender(
      <ViewerMenu
        {...baseProps}
        locale="ja"
        accountSlot={
          <AccountStatus
            account={{ username: "alice", role: "user" }}
            locale="ja"
            onSignIn={onSignIn}
            onSignOut={onSignOut}
          />
        }
      />,
    );
    expect(within(panel).getByText("alice (user)")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "サインアウト" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
