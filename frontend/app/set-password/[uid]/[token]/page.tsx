"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function SetPasswordPage() {
  const params = useParams<{ uid: string; token: string }>();
  const router = useRouter();
  const { completeInvite } = useAuth();

  const [password, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      await completeInvite(params.uid, params.token, password);
      router.push("/dashboard");
    } catch (err: any) {
      setError(
        err?.response?.data?.error || "This invite link is invalid or has expired."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0906] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-[#c9a96e]/15 bg-[#0f0c08] p-8"
      >
        <h1 className="mb-1 text-xl font-bold text-[#f0e6cc]">⚖️ Legal AI</h1>
        <p className="mb-6 text-sm text-[#8a7c68]">
          Set your password to activate your account
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <label className="mb-1 block text-xs text-[#8a7c68]">New password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPasswordValue(event.target.value)}
          required
          minLength={8}
          className="mb-4 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <label className="mb-1 block text-xs text-[#8a7c68]">Confirm password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={8}
          className="mb-6 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#c9a96e] py-2 font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {loading ? "Setting password..." : "Set password & log in"}
        </button>
      </form>
    </div>
  );
}
