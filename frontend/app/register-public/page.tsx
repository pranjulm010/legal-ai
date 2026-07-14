"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function RegisterPublicPage() {
  const router = useRouter();
  const { registerPublic } = useAuth();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await registerPublic(username, password, email, fullName);
      router.push("/app");
    } catch (err: any) {
      setError(err?.response?.data?.error || "Registration failed.");
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
          Continue as a public user — upload documents, ask legal questions, no law firm needed.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <label className="mb-1 block text-xs text-[#8a7c68]">Username</label>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          className="mb-4 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <label className="mb-1 block text-xs text-[#8a7c68]">Email</label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="mb-4 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <label className="mb-1 block text-xs text-[#8a7c68]">Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
          className="mb-4 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <label className="mb-1 block text-xs text-[#8a7c68]">Full name</label>
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          className="mb-6 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#c9a96e] py-2 font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Sign up as public user"}
        </button>

        <p className="mt-4 text-center text-sm text-[#8a7c68]">
          Representing a law firm?{" "}
          <Link href="/register" className="text-[#c9a96e] hover:underline">
            Register your firm instead
          </Link>
        </p>
        <p className="mt-2 text-center text-sm text-[#8a7c68]">
          Already have an account?{" "}
          <Link href="/login" className="text-[#c9a96e] hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
