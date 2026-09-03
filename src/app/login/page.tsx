import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in — EduFix PK",
  description: "Sign in or create an EduFix PK account.",
};

/**
 * /login — renders the unstyled, self-contained AuthForm client component.
 * Kept as a thin Server Component so the route owns metadata while all auth
 * state and Supabase calls live in the client component. The `auth-route`
 * wrapper is a stable hook for page-level CSS.
 */
export default function LoginPage() {
  return (
    <main className="auth-route">
      <AuthForm />
    </main>
  );
}
