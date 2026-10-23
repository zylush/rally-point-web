import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../types";
import LoginPage from "./LoginPage";

const authState = vi.hoisted(() => ({
  demo: false,
  loading: false,
  user: null as Profile | null,
  signIn: vi.fn(),
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

vi.mock("../components/RallyPointLogo", () => ({
  RallyPointLogo: () => <div aria-label="Rally Point logo" />,
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

function switchToJoin() {
  const buttons = screen.getAllByRole("button", { name: "Join as member" });
  return buttons[0];
}

function loginSubmitButton() {
  const button = screen
    .getAllByRole("button", { name: "Log in" })
    .find((candidate) => candidate.getAttribute("type") === "submit");
  if (!button) throw new Error("Could not find login submit button");
  return button;
}

describe("LoginPage authentication form safety", () => {
  beforeEach(() => {
    authState.demo = false;
    authState.loading = false;
    authState.user = null;
    authState.signIn.mockReset();
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

  it("shows public FAQ answers and clearly non-clickable social previews", async () => {
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

    const socialHeading = screen.getByRole("heading", { name: "Find us on social media" });
    const socialSection = socialHeading.parentElement;
    if (!socialSection) throw new Error("Social preview section is missing");
    expect(within(socialSection).getByText("Facebook")).toBeInTheDocument();
    expect(within(socialSection).getByText("Instagram")).toBeInTheDocument();
    expect(socialSection.querySelectorAll("a")).toHaveLength(0);
    expect(within(socialSection).getByText("Social links will be added when the official pages are confirmed.")).toBeInTheDocument();
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

    const signupForm = screen
      .getByRole("button", { name: "Join Rally Point" })
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

  it("shows the Privacy Notice acknowledgement only during signup", async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(
      screen.queryByText(/By registering, you acknowledge that you have read our/),
    ).not.toBeInTheDocument();
    await user.click(switchToJoin());

    expect(
      screen.getByText(/By registering, you acknowledge that you have read our/),
    ).toBeInTheDocument();
    const signupForm = screen
      .getByRole("button", { name: "Join Rally Point" })
      .closest("form");
    if (!signupForm) throw new Error("Signup form is missing");
    expect(within(signupForm).getByRole("link", { name: "Privacy Notice" })).toHaveAttribute(
      "href",
      "/privacy",
    );

    await user.click(screen.getAllByRole("button", { name: "Log in" })[0]);
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(
      screen.queryByText(/By registering, you acknowledge that you have read our/),
    ).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Join Rally Point" }));

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
      screen.getByText(/Staff \/ admin accounts are created by the club/i),
    ).toBeInTheDocument();

    unmount();
    authState.demo = true;
    renderLogin();

    expect(screen.getByText("Quick demo logins")).toBeInTheDocument();
    expect(
      screen.queryByText(/Staff \/ admin accounts are created by the club/i),
    ).not.toBeInTheDocument();
  });
});

describe("LoginPage return to a club page", () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
    authState.signIn.mockReset();
  });

  function renderWithReturn(returnTo: string) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { returnTo } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("goes back to the club page after logging in", async () => {
    const user = userEvent.setup();
    authState.signIn.mockResolvedValue({ id: "u1", email: "p@example.com", full_name: "Pia", role: "member", created_at: "2026-09-01" });
    renderWithReturn("/clubs/rally-point-davao");

    await user.type(screen.getByLabelText("Email"), "p@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(loginSubmitButton());
    expect(await screen.findByText("At /clubs/rally-point-davao")).toBeInTheDocument();
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

  it("ignores a return path outside the club pages", async () => {
    const user = userEvent.setup();
    authState.signIn.mockResolvedValue({ id: "u1", email: "p@example.com", full_name: "Pia", role: "member", created_at: "2026-09-01" });
    renderWithReturn("/admin/users");

    await user.type(screen.getByLabelText("Email"), "p@example.com");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(loginSubmitButton());
    expect(await screen.findByText("At /member")).toBeInTheDocument();
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

  function renderJoin(options: { returnTo?: string; joinClub?: { id: string; slug: string; name: string } } = {}) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { mode: "join", returnTo: options.returnTo } }]}>
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
    await user.click(screen.getByRole("button", { name: "Join Rally Point" }));
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

  it("confirms the code and goes where sign-up would have gone", async () => {
    const user = userEvent.setup();
    authState.verifySignupCode.mockResolvedValue(newMember);
    renderJoin({ returnTo: "/clubs/rally-point-davao" });
    await fillAndJoin(user);

    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));

    expect(authState.verifySignupCode).toHaveBeenCalledWith("new@example.com", "123456");
    expect(await screen.findByText("At /clubs/rally-point-davao")).toBeInTheDocument();
  });

  it("goes to the member home after confirming without a return path", async () => {
    const user = userEvent.setup();
    authState.verifySignupCode.mockResolvedValue(newMember);
    renderJoin({ joinClub: { id: "club-davao", slug: "rally-point-davao", name: "Rally Point Davao" } });
    await fillAndJoin(user);

    expect(await screen.findByText("Joining Rally Point Davao")).toBeInTheDocument();
    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByText("At /member")).toBeInTheDocument();
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Join Rally Point" }));
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Join Rally Point" }));
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

  it("signs straight in when the account needs no code", async () => {
    const user = userEvent.setup();
    authState.signUpMember.mockResolvedValue({ status: "signed_in", profile: newMember });
    renderJoin();
    await fillAndJoin(user);

    expect(await screen.findByText("At /member")).toBeInTheDocument();
    expect(authState.verifySignupCode).not.toHaveBeenCalled();
  });
});
