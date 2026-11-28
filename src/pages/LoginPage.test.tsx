import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../types";
import { LOGIN_PHOTO } from "../lib/stockPhotos";
import LoginPage from "./LoginPage";

const authState = vi.hoisted(() => ({
  demo: false,
  loading: false,
  user: null as Profile | null,
  signIn: vi.fn(),
  signInWithGoogle: undefined as (() => Promise<void>) | undefined,
  signUpMember: vi.fn(),
  verifySignupCode: vi.fn(),
  resendSignupCode: vi.fn(),
  resetPassword: vi.fn(),
  signOut: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../components/BrinelyLogo", () => ({
  BrinelyLogo: () => <div aria-label="bRineLy logo" />,
}));

function Where() {
  return <p>At {useLocation().pathname}</p>;
}

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

function renderLoginDialog(props: {
  onClose?: () => void;
  onAuthenticated?: (profile: Profile) => void;
  clubName?: string;
  clubSlug?: string;
  bookingSummary?: string;
} = {}) {
  return render(
    <MemoryRouter>
      <LoginPage
        dialog
        clubName={props.clubName}
        clubSlug={props.clubSlug}
        bookingSummary={props.bookingSummary}
        onClose={props.onClose ?? vi.fn()}
        onAuthenticated={props.onAuthenticated ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

function switchToJoin() {
  const buttons = screen.getAllByRole("button", { name: "Sign up" });
  return buttons[0];
}

/** The sign-up form's submit button (the "Sign up" tab has the same name). */
function signUpSubmitButton() {
  const button = screen
    .getAllByRole("button", { name: "Sign up" })
    .find((candidate) => candidate.getAttribute("type") === "submit");
  if (!button) throw new Error("Could not find sign-up submit button");
  return button;
}

function loginSubmitButton() {
  const button = screen
    .getAllByRole("button", { name: "Log in" })
    .find((candidate) => candidate.getAttribute("type") === "submit");
  if (!button) throw new Error("Could not find login submit button");
  return button;
}

function scrollPrivacyReaderToEnd(scope?: HTMLElement) {
  const reader = scope
    ? within(scope).getByRole("region", { name: "Privacy Notice text" })
    : screen.getByRole("region", { name: "Privacy Notice text" });
  Object.defineProperty(reader, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(reader, "clientHeight", { configurable: true, value: 200 });
  Object.defineProperty(reader, "scrollTop", { configurable: true, writable: true, value: 790 });
  fireEvent.scroll(reader);
  return reader;
}

async function unlockAndTickPrivacy(
  user: ReturnType<typeof userEvent.setup>,
  scope?: HTMLElement,
) {
  const toggle = scope
    ? within(scope).getByRole("button", { name: /Read the Privacy Notice/ })
    : screen.getByRole("button", { name: /Read the Privacy Notice/ });
  await user.click(toggle);
  scrollPrivacyReaderToEnd(scope);
  const checkbox = scope
    ? within(scope).getByRole("checkbox", { name: /I have read and understood the Privacy Notice/ })
    : screen.getByRole("checkbox", { name: /I have read and understood the Privacy Notice/ });
  await user.click(checkbox);
  return checkbox;
}

describe("LoginPage authentication form safety", () => {
  beforeEach(() => {
    authState.demo = false;
    authState.loading = false;
    authState.user = null;
    authState.signIn.mockReset();
    authState.signInWithGoogle = undefined;
    authState.signUpMember.mockReset();
    authState.resetPassword.mockReset();
    authState.signOut.mockReset();
    authState.refresh.mockReset();
  });

  it("transfers the email from login to sign up but clears the password", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "Player@Example.com");
    await user.type(screen.getByLabelText("Password"), "never-copy-this");
    const joinButton = switchToJoin();
    expect(joinButton).toHaveClass("min-h-12");
    await user.click(joinButton);

    expect(screen.getByLabelText("Email")).toHaveValue("Player@Example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("preserves the email when returning to login and never writes form passwords to web storage", async () => {
    const user = userEvent.setup();
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");
    renderLogin();

    await user.click(switchToJoin());
    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), "not-persisted");
    await user.click(screen.getAllByRole("button", { name: "Log in" })[0]);

    expect(screen.getByLabelText("Email")).toHaveValue("player@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(storageSetItem).not.toHaveBeenCalled();
    storageSetItem.mockRestore();
  });

  it("never transfers a typed password into the URL, session storage, or cookies", async () => {
    const user = userEvent.setup();
    const testPassphrase = "sensitive-form-input";
    window.history.replaceState({}, "", "/login?source=member#access");
    sessionStorage.clear();
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), testPassphrase);
    await user.click(switchToJoin());

    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(window.location.href).not.toContain(testPassphrase);
    const persistedSessionValues = Array.from(
      { length: sessionStorage.length },
      (_, index) => {
        const key = sessionStorage.key(index);
        return key ? sessionStorage.getItem(key) : null;
      },
    ).join("\n");
    expect(persistedSessionValues).not.toContain(testPassphrase);
    expect(document.cookie).not.toContain(testPassphrase);
  });

  it("toggles password visibility with an accessible keyboard control", async () => {
    const user = userEvent.setup();
    renderLogin();

    const password = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    expect(password).toHaveAttribute("type", "password");
    expect(toggle).toHaveClass("min-h-12", "min-w-12");

    toggle.focus();
    await user.keyboard("{Enter}");

    expect(password).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");

    toggle.focus();
    await user.keyboard(" ");
    expect(password).toHaveAttribute("type", "text");
  });

  it("maps the hosted Supabase rate-limit error to a clear generic message", async () => {
    const user = userEvent.setup();
    authState.signIn.mockRejectedValue(new Error("Request rate limit reached"));
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(loginSubmitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Please try again in about 5 minutes.",
    );
    expect(authState.signIn).toHaveBeenCalledWith(
      "player@example.com",
      "wrong-password",
    );
  });

  it("shows the reset password form and preserves email", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.type(screen.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(screen.getByLabelText("Email")).toHaveValue("player@example.com");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeInTheDocument();
  });

  it("shows public FAQ answers", async () => {
    const user = userEvent.setup();
    renderLogin();

    const faqRegion = screen.getByRole("region", { name: "Quick questions" });
    expect(within(faqRegion).getAllByRole("group")).toHaveLength(3);
    expect(screen.getByText("More FAQs and Contact Us are available in Help after you sign in.")).toBeInTheDocument();
    const bookingQuestion = screen.getByText("How do I book a court?");
    await user.click(bookingQuestion);
    expect(
      screen.getByText(/choose a date, court, and time, then complete payment/i),
    ).toBeInTheDocument();
  });

  it("shows the login photo and a plain heading, with no video", () => {
    const { container } = renderLogin();

    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: LOGIN_PHOTO.alt })).toBeInTheDocument();
    // General imagery, not a club's venue, so it carries no "Sample photo" label.
    expect(screen.queryByText("Sample photo")).not.toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
    // The page's own form is the only way in, so the header has no Log in link.
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
    expect(document.title).toBe("Log in · bRineLy");
  });

  it("names the sign-up page in join mode", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "join" } }]}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Create your player account" })).toBeInTheDocument();
    expect(document.title).toBe("Sign up · bRineLy");
    // One word for the action: the tab and the submit button both say "Sign up".
    expect(screen.getByRole("button", { name: "Log in", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign up", pressed: true })).toBeInTheDocument();
    expect(signUpSubmitButton()).toBeInTheDocument();
    // The password rule stays visible, not only as a placeholder.
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("At least 6 characters.");
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("placeholder");
  });

  it("links to the public Privacy Notice", () => {
    renderLogin();

    expect(screen.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("keeps a join link's club and the typed details when the Privacy Notice is opened", () => {
    render(
      <MemoryRouter>
        <LoginPage joinClub={{ id: "club-davao", slug: "rally-point-davao", name: "Rally Point Davao" }} />
      </MemoryRouter>,
    );

    const signupForm = signUpSubmitButton()
      .closest("form");
    if (!signupForm) throw new Error("Signup form is missing");
    const formLink = within(signupForm).getByRole("link", { name: "Privacy Notice" });
    // A new tab, so leaving the form never clears what was typed.
    expect(formLink).toHaveAttribute("href", "/privacy?club=rally-point-davao");
    expect(formLink).toHaveAttribute("target", "_blank");
    expect(within(signupForm).getByText(/opens in a new tab/)).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "Privacy Notice" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/privacy?club=rally-point-davao",
      "/privacy?club=rally-point-davao",
    ]);
  });

  it("shows the Privacy Notice checkbox and inline reader only during signup", async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(
      screen.queryByRole("checkbox", { name: /I have read and understood the Privacy Notice/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Read the Privacy Notice/ })).not.toBeInTheDocument();

    await user.click(switchToJoin());

    const checkbox = screen.getByRole("checkbox", {
      name: /I have read and understood the Privacy Notice/,
    });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();

    const toggle = screen.getByRole("button", { name: /Read the Privacy Notice/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const reader = screen.getByRole("region", { name: "Privacy Notice text" });
    expect(within(reader).getByText(/Direct-to-club payments:/)).toBeVisible();
    expect(within(reader).getByText("Your rights under RA 10173:")).toBeVisible();
    expect(within(reader).getByText("Privacy contact and notice updates")).toBeVisible();
    expect(checkbox).toBeDisabled();

    scrollPrivacyReaderToEnd();
    expect(checkbox).toBeEnabled();
    expect(checkbox).not.toBeChecked();

    const signupForm = signUpSubmitButton().closest("form");
    if (!signupForm) throw new Error("Signup form is missing");
    const noticeLink = within(signupForm).getByRole("link", { name: "Privacy Notice" });
    expect(noticeLink).toHaveAttribute("href", "/privacy");
    expect(noticeLink).toHaveAttribute("target", "_blank");

    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getAllByRole("button", { name: "Log in" })[0]);
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(
      screen.queryByRole("checkbox", { name: /I have read and understood the Privacy Notice/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to log in" }));
    await user.click(switchToJoin());
    const resetCheckbox = screen.getByRole("checkbox", {
      name: /I have read and understood the Privacy Notice/,
    });
    expect(resetCheckbox).toBeDisabled();
    expect(resetCheckbox).not.toBeChecked();
  });

  it("blocks sign-up submit until the Privacy Notice is read to the end and ticked", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(switchToJoin());
    await user.type(screen.getByLabelText("Full name"), "Pat Player");
    await user.type(screen.getByLabelText("Email"), "pat@example.com");
    await user.type(screen.getByLabelText("Password"), "valid-passphrase");
    await user.click(signUpSubmitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Read to the end of the Privacy Notice first, then tick the box.",
    );
    const reader = screen.getByRole("region", { name: "Privacy Notice text" });
    expect(reader).toHaveFocus();
    expect(authState.signUpMember).not.toHaveBeenCalled();

    scrollPrivacyReaderToEnd();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", {
      name: /I have read and understood the Privacy Notice/,
    });
    expect(checkbox).toBeEnabled();
    expect(checkbox).not.toBeChecked();

    await user.click(signUpSubmitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tick the box to confirm you have read the Privacy Notice.",
    );
    expect(checkbox).toHaveFocus();
    expect(authState.signUpMember).not.toHaveBeenCalled();

    await user.click(checkbox);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends a password reset request and shows a success message", async () => {
    const user = userEvent.setup();
    authState.resetPassword.mockResolvedValue(undefined);
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "player@example.com");
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(authState.resetPassword).toHaveBeenCalledWith("player@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Check your inbox for a password reset link.",
    );
  });

  it("returns to login when back from reset mode", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.click(screen.getByRole("button", { name: "Back to log in" }));

    expect(loginSubmitButton()).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("does not reveal whether an email already exists during signup", async () => {
    const user = userEvent.setup();
    authState.signUpMember.mockRejectedValue(new Error("User already registered"));
    renderLogin();

    await user.click(switchToJoin());
    await user.type(screen.getByLabelText("Full name"), "Existing Player");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password"), "valid-passphrase");
    await unlockAndTickPrivacy(user);
    await user.click(signUpSubmitButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Unable to create an account. Please check your details or try again.",
    );
    expect(alert).not.toHaveTextContent(/already registered/i);
  });

  it("keeps demo-only accounts visibly separate from live authentication", () => {
    authState.demo = false;
    const { unmount } = renderLogin();

    expect(screen.queryByText("Quick demo logins")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Staff and admin accounts are created by the club/i),
    ).toBeInTheDocument();

    unmount();
    authState.demo = true;
    renderLogin();

    expect(screen.getByText("Quick demo logins")).toBeInTheDocument();
    expect(
      screen.queryByText(/Staff and admin accounts are created by the club/i),
    ).not.toBeInTheDocument();
  });
});

describe("LoginPage page state", () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
    authState.signIn.mockReset();
  });

  it("opens the sign-up tab when Find a court asks for it", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "join" } }]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(switchToJoin()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
  });

  it("tells a court owner which email to use when the owner page opens sign-up", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "join", owner: true } }]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(switchToJoin()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Court owner\? Use the email you gave bRineLy\./)).toBeInTheDocument();
  });

  it("shows a court owner why they cannot log in while their club is being set up", async () => {
    const user = userEvent.setup();
    authState.signIn.mockRejectedValue(
      new Error("Your owner account is ready. Cebu Hub is still being set up. You can log in as soon as bRineLy opens it."),
    );
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(loginSubmitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your owner account is ready. Cebu Hub is still being set up. You can log in as soon as bRineLy opens it.",
    );
  });

  it("shows no owner note on the usual sign-up", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "join" } }]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Court owner\?/)).not.toBeInTheDocument();
  });

  it("takes a player back to the page they came from", async () => {
    const user = userEvent.setup();
    authState.signIn.mockResolvedValue({ id: "u1", email: "p@example.com", full_name: "Pia", role: "member", created_at: "2026-09-01" });
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: "/clubs/rally-point-davao" } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "p@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(loginSubmitButton());
    expect(await screen.findByText("At /clubs/rally-point-davao")).toBeInTheDocument();
  });

  it("sends staff to their desk whatever page they came from", async () => {
    const user = userEvent.setup();
    authState.signIn.mockResolvedValue({ id: "u2", email: "s@example.com", full_name: "Sam", role: "staff", created_at: "2026-09-01" });
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: "/clubs/rally-point-davao" } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "s@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(loginSubmitButton());
    expect(await screen.findByText("At /staff")).toBeInTheDocument();
  });

  it("never returns to the sign-in page itself or to another site", async () => {
    const user = userEvent.setup();
    authState.signIn.mockResolvedValue({ id: "u1", email: "p@example.com", full_name: "Pia", role: "member", created_at: "2026-09-01" });
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: "//evil.example/steal" } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "p@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(loginSubmitButton());
    expect(await screen.findByText("At /clubs")).toBeInTheDocument();
  });
});

describe("LoginPage booking dialog", () => {
  const profile: Profile = {
    id: "u3",
    email: "player@example.com",
    full_name: "Pia Player",
    role: "member",
    created_at: "2026-09-01",
  };

  beforeEach(() => {
    authState.demo = false;
    authState.user = null;
    authState.loading = false;
    authState.signIn.mockReset();
    authState.signInWithGoogle = undefined;
  });

  afterEach(() => {
    document.getElementById("root")?.remove();
    document.body.style.overflow = "";
  });

  async function submitLogin(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Email"), profile.email);
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(loginSubmitButton());
  }

  /** The dimmed layer around the card; a tap on it closes the dialog. */
  function backdrop() {
    const layer = screen.getByRole("dialog").closest(".fixed");
    if (!(layer instanceof HTMLElement)) throw new Error("Could not find the dialog backdrop");
    return layer;
  }

  it("supports sign-in in an accessible dialog and reports success without navigating", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const onClose = vi.fn();
    authState.signIn.mockResolvedValue(profile);
    renderLoginDialog({
      onAuthenticated,
      onClose,
      clubName: "Rally Point Davao",
      bookingSummary: "Court A · Nov 25 · 6–7 AM · Php 500.00",
    });

    // One title names the club being booked, with that club's badge (not the bRineLy mark).
    const dialog = screen.getByRole("dialog", { name: "Log in to book at Rally Point Davao" });
    expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
    expect(within(dialog).getByText("RD")).toBeInTheDocument();
    expect(within(dialog).queryByRole("img", { name: "bRineLy" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("Court A · Nov 25 · 6–7 AM · Php 500.00")).toBeInTheDocument();
    expect(within(dialog).queryByText(/all log in here/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("By continuing, you confirm you are booking under your account.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    await submitLogin(user);

    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(onAuthenticated).toHaveBeenCalledWith(profile);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Log in to book at Rally Point Davao" })).toBe(dialog);
  });

  it("reports an existing session when it finishes loading in the dialog", async () => {
    const returning: Profile = {
      id: "u4",
      email: "returning@example.com",
      full_name: "Returning Player",
      role: "member",
      created_at: "2026-09-01",
    };
    const onAuthenticated = vi.fn();
    const onClose = vi.fn();
    authState.loading = true;
    const view = renderLoginDialog({ onAuthenticated, onClose });

    authState.user = returning;
    authState.loading = false;
    view.rerender(
      <MemoryRouter>
        <LoginPage dialog onClose={onClose} onAuthenticated={onAuthenticated} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(returning));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open while a sign-in is still running", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let failSignIn: (error: Error) => void = () => {};
    authState.signIn.mockReturnValue(
      new Promise<Profile>((_resolve, reject) => {
        failSignIn = reject;
      }),
    );
    renderLoginDialog({ onClose });

    await submitLogin(user);
    expect(screen.getByRole("button", { name: "Close sign-in" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Log in to book" })).toBeInTheDocument();

    await act(async () => failSignIn(new Error("Invalid login credentials")));
  });

  it("shows a failed sign-in inside the dialog, then closes on Escape, the backdrop or the X", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onAuthenticated = vi.fn();
    authState.signIn.mockRejectedValue(new Error("Invalid login credentials"));
    renderLoginDialog({ onClose, onAuthenticated });

    await submitLogin(user);
    const dialog = screen.getByRole("dialog", { name: "Log in to book" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Unable to log in. Check your email and password, then try again.",
    );
    expect(onAuthenticated).not.toHaveBeenCalled();

    // A click inside the card is not a click on the backdrop.
    await user.click(within(dialog).getByRole("heading", { name: "Log in to book" }));
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await user.click(backdrop());
    await user.click(within(dialog).getByRole("button", { name: "Close sign-in" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("locks the page behind it and puts everything back when it closes", () => {
    const root = document.createElement("div");
    root.id = "root";
    const opener = document.createElement("button");
    opener.textContent = "Book a court";
    root.append(opener);
    document.body.append(root);
    document.body.style.overflow = "auto";
    opener.focus();
    const onClose = vi.fn();

    const view = renderLoginDialog({ onClose });
    expect(root.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByLabelText("Email")).toHaveFocus();

    view.unmount();
    expect(root.inert).toBe(false);
    expect(document.body.style.overflow).toBe("auto");
    expect(opener).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("names the sign-up step in the dialog's title", async () => {
    const user = userEvent.setup();
    renderLoginDialog({ clubName: "Rally Point Davao" });

    await user.click(switchToJoin());
    const dialog = screen.getByRole("dialog", { name: "Sign up to book at Rally Point Davao" });
    expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
    expect(within(dialog).getByText("For players only. View availability, open play, and your QR pass.")).toBeInTheDocument();
  });

  it("blocks Google sign-up in the booking dialog until the Privacy Notice is read and ticked and links that club's notice", async () => {
    const user = userEvent.setup();
    const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
    authState.signInWithGoogle = signInWithGoogle;
    renderLoginDialog({ clubName: "Rally Point Davao", clubSlug: "rally-point-davao" });

    await user.click(switchToJoin());
    const dialog = screen.getByRole("dialog", { name: "Sign up to book at Rally Point Davao" });
    expect(within(dialog).getByRole("link", { name: "Privacy Notice" })).toHaveAttribute(
      "href",
      "/privacy?club=rally-point-davao",
    );

    await user.click(within(dialog).getByRole("button", { name: "Continue with Google" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Read to the end of the Privacy Notice first, then tick the box.",
    );
    const reader = within(dialog).getByRole("region", { name: "Privacy Notice text" });
    expect(reader).toHaveFocus();
    expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
    expect(signInWithGoogle).not.toHaveBeenCalled();

    scrollPrivacyReaderToEnd(dialog);
    await user.click(within(dialog).getByRole("button", { name: "Continue with Google" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Tick the box to confirm you have read the Privacy Notice.",
    );
    const checkbox = within(dialog).getByRole("checkbox", {
      name: /I have read and understood the Privacy Notice/,
    });
    expect(checkbox).toHaveFocus();
    expect(signInWithGoogle).not.toHaveBeenCalled();

    await user.click(checkbox);
    await user.click(within(dialog).getByRole("button", { name: "Continue with Google" }));
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    renderLoginDialog();
    const close = screen.getByRole("button", { name: "Close sign-in" });
    const joinButtons = screen.getAllByRole("button", { name: "Sign up" });
    const last = joinButtons[joinButtons.length - 1];

    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(last).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(close).toHaveFocus();
  });
});

describe("LoginPage sign-up code step", () => {
  const newMember: Profile = {
    id: "u2",
    email: "new@example.com",
    full_name: "Nina New",
    role: "member",
    created_at: "2026-10-23",
  };

  beforeEach(() => {
    authState.demo = false;
    authState.loading = false;
    authState.user = null;
    authState.signUpMember.mockReset();
    authState.verifySignupCode.mockReset();
    authState.resendSignupCode.mockReset();
    authState.signUpMember.mockResolvedValue({ status: "needs_code", email: "new@example.com" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The countdown schedules one tick per second after each render, so step a second at a time.
  function advanceSeconds(seconds: number) {
    for (let i = 0; i < seconds; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
  }

  function renderJoin(options: { joinClub?: { id: string; slug: string; name: string } } = {}) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "join" } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage joinClub={options.joinClub} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  async function fillAndJoin(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Full name"), "Nina New");
    await user.type(screen.getByLabelText("Mobile (optional)"), "09171234567");
    await user.type(screen.getByLabelText("Email"), "New@Example.com");
    await user.type(screen.getByLabelText("Password"), "secret-pass");
    await unlockAndTickPrivacy(user);
    await user.click(signUpSubmitButton());
  }

  it("asks for the emailed code instead of showing an error", async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillAndJoin(user);

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText("new@example.com")).toBeInTheDocument();
    const codeInput = screen.getByLabelText("6-digit code");
    expect(codeInput).toHaveAttribute("inputmode", "numeric");
    expect(codeInput).toHaveAttribute("autocomplete", "one-time-code");
    expect(codeInput).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("keeps only digits from a pasted or typed code", async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillAndJoin(user);

    const codeInput = await screen.findByLabelText("6-digit code");
    fireEvent.change(codeInput, { target: { value: "12 34-56" } });
    expect(codeInput).toHaveValue("123456");
    await user.clear(codeInput);
    await user.paste("Your code: 654 321");
    expect(codeInput).toHaveValue("654321");
    await user.clear(codeInput);
    await user.type(codeInput, "12 34 56 7");
    expect(codeInput).toHaveValue("123456");
  });

  it("confirms the code and goes to the member home", async () => {
    const user = userEvent.setup();
    authState.verifySignupCode.mockResolvedValue(newMember);
    renderJoin();
    await fillAndJoin(user);

    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));

    expect(authState.verifySignupCode).toHaveBeenCalledWith("new@example.com", "123456");
    expect(await screen.findByText("At /clubs")).toBeInTheDocument();
  });

  it("reports a confirmed sign-up to the booking dialog instead of navigating away", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    authState.verifySignupCode.mockResolvedValue(newMember);
    render(
      <MemoryRouter>
        <LoginPage dialog onAuthenticated={onAuthenticated} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(switchToJoin());
    await fillAndJoin(user);
    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));

    expect(authState.verifySignupCode).toHaveBeenCalledWith("new@example.com", "123456");
    expect(onAuthenticated).toHaveBeenCalledWith(newMember);
    expect(screen.getByRole("dialog", { name: "Check your email" })).toBeInTheDocument();
  });

  it("goes to the member home after confirming a join link sign-up", async () => {
    const user = userEvent.setup();
    authState.verifySignupCode.mockResolvedValue(newMember);
    renderJoin({ joinClub: { id: "club-davao", slug: "rally-point-davao", name: "Rally Point Davao" } });
    await fillAndJoin(user);

    expect(await screen.findByText("Joining Rally Point Davao")).toBeInTheDocument();
    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByText("At /clubs")).toBeInTheDocument();
  });

  it("explains a wrong or expired code and stays on the code step", async () => {
    const user = userEvent.setup();
    authState.verifySignupCode.mockRejectedValue(
      Object.assign(new Error("Token has expired or is invalid"), { code: "otp_expired", status: 403 }),
    );
    renderJoin();
    await fillAndJoin(user);

    await user.type(await screen.findByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code is wrong or has expired. Check the newest email or send a new code.",
    );
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByLabelText("6-digit code")).toHaveFocus();
    expect(screen.queryByText(/^At \//)).not.toBeInTheDocument();
  });

  it("asks for all six digits before checking the code", async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillAndJoin(user);

    await user.type(await screen.findByLabelText("6-digit code"), "123");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the 6-digit code from the email.");
    expect(authState.verifySignupCode).not.toHaveBeenCalled();
  });

  it("maps too many attempts to a plain message", async () => {
    const user = userEvent.setup();
    authState.verifySignupCode.mockRejectedValue(
      Object.assign(new Error("Request rate limit reached"), { code: "over_request_rate_limit", status: 429 }),
    );
    renderJoin();
    await fillAndJoin(user);

    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Please try again in about 5 minutes.",
    );
  });

  it("waits 60 seconds before a new code can be sent, and again after each resend", async () => {
    vi.useFakeTimers();
    authState.resendSignupCode.mockResolvedValue(undefined);
    renderJoin();

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Nina New" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /Read the Privacy Notice/ }));
    fireEvent.click(screen.getByRole("button", { name: "Unlock checkbox" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I have read and understood the Privacy Notice/ }));
    await act(async () => {
      fireEvent.click(signUpSubmitButton());
    });

    expect(screen.getByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    const waiting = screen.getByRole("button", { name: "Send a new code in 60s" });
    expect(waiting).toBeDisabled();

    advanceSeconds(30);
    expect(screen.getByRole("button", { name: "Send a new code in 30s" })).toBeDisabled();

    advanceSeconds(30);
    const ready = screen.getByRole("button", { name: "Send a new code" });
    expect(ready).toBeEnabled();

    await act(async () => {
      fireEvent.click(ready);
    });
    expect(authState.resendSignupCode).toHaveBeenCalledWith("new@example.com");
    expect(screen.getByRole("status")).toHaveTextContent("We sent a new code to new@example.com.");
    expect(screen.getByRole("button", { name: "Send a new code in 60s" })).toBeDisabled();
  });

  it("explains when too many codes have been sent", async () => {
    vi.useFakeTimers();
    authState.resendSignupCode.mockRejectedValue(
      Object.assign(new Error("email rate limit exceeded"), { code: "over_email_send_rate_limit", status: 429 }),
    );
    renderJoin();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Nina New" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /Read the Privacy Notice/ }));
    fireEvent.click(screen.getByRole("button", { name: "Unlock checkbox" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I have read and understood the Privacy Notice/ }));
    await act(async () => {
      fireEvent.click(signUpSubmitButton());
    });
    advanceSeconds(60);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Too many codes were sent. Please wait a few minutes, then send a new code.",
    );
  });

  it("goes back to the form with the details kept and the password cleared", async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillAndJoin(user);

    await user.click(await screen.findByRole("button", { name: "Use a different email" }));

    expect(screen.getByLabelText("Full name")).toHaveValue("Nina New");
    expect(screen.getByLabelText("Mobile (optional)")).toHaveValue("09171234567");
    expect(screen.getByLabelText("Email")).toHaveValue("New@Example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByLabelText("6-digit code")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("sends the person to Log in when the code worked but the account could not be opened", async () => {
    const user = userEvent.setup();
    authState.verifySignupCode.mockRejectedValue(
      new Error("Your club profile is not ready. Please try again or contact staff."),
    );
    renderJoin();
    await fillAndJoin(user);

    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your email is confirmed, but your account could not be opened. Please log in.",
    );
    expect(screen.queryByLabelText("6-digit code")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("New@Example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("tells a court owner what happens next once the code is confirmed", async () => {
    const user = userEvent.setup();
    authState.verifySignupCode.mockRejectedValue(
      new Error("Your owner account is ready. Cebu Hub is still being set up. You can log in as soon as bRineLy opens it."),
    );
    renderJoin();
    await fillAndJoin(user);

    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your owner account is ready. Cebu Hub is still being set up. You can log in as soon as bRineLy opens it.",
    );
    expect(screen.queryByLabelText("6-digit code")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });

  it("signs straight in when the account needs no code", async () => {
    const user = userEvent.setup();
    authState.signUpMember.mockResolvedValue({ status: "signed_in", profile: newMember });
    renderJoin();
    await fillAndJoin(user);

    expect(await screen.findByText("At /clubs")).toBeInTheDocument();
    expect(authState.verifySignupCode).not.toHaveBeenCalled();
  });
});
