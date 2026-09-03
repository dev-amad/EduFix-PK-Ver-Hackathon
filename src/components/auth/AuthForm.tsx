"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * AuthForm — functional, UNSTYLED authentication component for EduFix PK.
 *
 * A self-contained client component that owns its view/field state and wires the
 * submit + "Forgot Password" actions to Supabase Auth (the same @supabase/ssr
 * browser client used across the app). It is deliberately unstyled: every element
 * carries a stable, semantic wrapper class (auth-*, form-*, password-*) so a
 * stylesheet can be layered on later without touching this logic.
 *
 * Views:
 *   - Sign In  -> email + password, plus a "Forgot Password?" action
 *   - Sign Up  -> email + password + confirm password
 * Every password field has a Show/Hide toggle that flips its input type between
 * "password" (hidden) and "text" (visible).
 */

type AuthView = "signin" | "signup";
type StatusKind = "idle" | "loading" | "success" | "error";

interface Status {
  kind: StatusKind;
  message: string;
}

const IDLE: Status = { kind: "idle", message: "" };
const MIN_PASSWORD = 8;

export function AuthForm() {
  const router = useRouter();

  const [view, setView] = useState<AuthView>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);

  const isSubmitting = status.kind === "loading";
  const isSignIn = view === "signin";
  const passwordsMatch = password === confirmPassword;

  function switchView(next: AuthView) {
    if (next === view) return;
    setView(next);
    // Clear secrets when switching modes so nothing leaks between views.
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setStatus(IDLE);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setStatus({ kind: "error", message: "Enter your email and password." });
      return;
    }
    if (!isSignIn && !passwordsMatch) {
      setStatus({ kind: "error", message: "Passwords do not match." });
      return;
    }

    // Created lazily inside the handler so it never runs during SSR/prerender
    // (the browser client touches document.cookie, which is client-only).
    const supabase = createSupabaseBrowserClient();
    setStatus({ kind: "loading", message: "" });

    try {
      if (isSignIn) {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        setStatus({ kind: "success", message: "Signed in. Redirecting…" });
        router.push("/");
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });
      if (error) throw error;

      // When email confirmation is enabled Supabase returns no session yet.
      if (data.session) {
        setStatus({ kind: "success", message: "Account created. Redirecting…" });
        router.push("/");
        router.refresh();
      } else {
        setStatus({
          kind: "success",
          message: "Account created. Check your email to confirm your address.",
        });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Authentication failed.",
      });
    }
  }

  async function handleForgotPassword() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setStatus({
        kind: "error",
        message: "Enter your email address above, then choose Forgot Password.",
      });
      return;
    }

    const supabase = createSupabaseBrowserClient();
    setStatus({ kind: "loading", message: "" });

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        // A /reset-password route completes this flow; Supabase appends the
        // recovery token to this URL when the user opens the emailed link.
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setStatus({
        kind: "success",
        message:
          "If that email is registered, a password reset link is on its way.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not send the reset email.",
      });
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <header className="auth-header">
          <h1 className="auth-title">
            {isSignIn ? "Sign in to EduFix PK" : "Create your EduFix PK account"}
          </h1>
          <p className="auth-subtitle">
            {isSignIn
              ? "Welcome back. Enter your details to continue."
              : "Register with your email to start using EduFix PK."}
          </p>
        </header>

        {/* View switcher */}
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            id="auth-tab-signin"
            aria-selected={isSignIn}
            aria-controls="auth-panel"
            className={
              isSignIn
                ? "auth-tab auth-tab--signin auth-tab--active"
                : "auth-tab auth-tab--signin"
            }
            onClick={() => switchView("signin")}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            id="auth-tab-signup"
            aria-selected={!isSignIn}
            aria-controls="auth-panel"
            className={
              isSignIn
                ? "auth-tab auth-tab--signup"
                : "auth-tab auth-tab--signup auth-tab--active"
            }
            onClick={() => switchView("signup")}
          >
            Sign Up
          </button>
        </div>

        {/* Feedback region (error / success / loading) */}
        <div
          className={`auth-status auth-status--${status.kind}`}
          role={status.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          hidden={status.kind === "idle"}
        >
          {status.message}
        </div>

        <form
          className="auth-form form"
          id="auth-panel"
          role="tabpanel"
          aria-labelledby={isSignIn ? "auth-tab-signin" : "auth-tab-signup"}
          onSubmit={handleSubmit}
        >
          <div className="form-field form-field--email input-span">
            <label className="form-label label" htmlFor="auth-email">
              Email address
            </label>
            <input
              className="form-input"
              id="auth-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="form-field form-field--password input-span">
            <label className="form-label label" htmlFor="auth-password">
              Password
            </label>
            <div className="password-control">
              <input
                className="form-input password-input"
                id="auth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isSignIn ? "current-password" : "new-password"}
                required
                minLength={isSignIn ? undefined : MIN_PASSWORD}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {!isSignIn ? (
            <div className="form-field form-field--confirm-password input-span">
              <label className="form-label label" htmlFor="auth-confirm-password">
                Confirm password
              </label>
              <div className="password-control">
                <input
                  className="form-input password-input"
                  id="auth-confirm-password"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter your password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  aria-pressed={showConfirmPassword}
                  aria-label={
                    showConfirmPassword ? "Hide password" : "Show password"
                  }
                >
                  {showConfirmPassword ? "Hide" : "Show"}
                </button>
              </div>
              {confirmPassword.length > 0 && !passwordsMatch ? (
                <p className="field-error" role="alert">
                  Passwords do not match.
                </p>
              ) : null}
            </div>
          ) : null}

          {isSignIn ? (
            <div className="form-extras">
              <button
                type="button"
                className="link-button forgot-password-button"
                onClick={handleForgotPassword}
              >
                Forgot Password?
              </button>
            </div>
          ) : null}

          <button
            type="submit"
            className="submit-button submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? isSignIn
                ? "Signing in…"
                : "Creating account…"
              : isSignIn
                ? "Sign In"
                : "Sign Up"}
          </button>
        </form>

        <footer className="auth-footer">
          <p className="auth-switch span">
            {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="link-button auth-switch-button"
              onClick={() => switchView(isSignIn ? "signup" : "signin")}
            >
              {isSignIn ? "Sign up" : "Sign in"}
            </button>
          </p>
        </footer>
      </div>
    </div>
  );
}
