"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [firmSize, setFirmSize] = useState("solo");
  const [barRegistrationNumber, setBarRegistrationNumber] = useState("");
  const [address, setAddress] = useState("");
  const [officialEmailDomain, setOfficialEmailDomain] = useState("");
  const [practiceAreas, setPracticeAreas] = useState("");
  const [employeeCount, setEmployeeCount] = useState(0);
  const [lawyerCount, setLawyerCount] = useState(0);
  const [officeLocations, setOfficeLocations] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await register(username, password, email, fullName, firmName || undefined, firmSize, {
        barRegistrationNumber,
        address,
        officialEmailDomain,
        practiceAreas,
        employeeCount,
        lawyerCount,
        officeLocations,
        phone,
        website,
        gstNumber,
      });
      router.push("/dashboard");
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
          Create your account
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
          className="mb-4 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <label className="mb-1 block text-xs text-[#8a7c68]">
          Firm name (leave blank if you're signing up individually)
        </label>
        <input
          value={firmName}
          onChange={(event) => setFirmName(event.target.value)}
          className="mb-4 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <label className="mb-1 block text-xs text-[#8a7c68]">Firm size</label>
        <select
          value={firmSize}
          onChange={(event) => setFirmSize(event.target.value)}
          className="mb-6 w-full rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        >
          <option value="solo">Solo (just me)</option>
          <option value="small">Small (2-10 lawyers)</option>
          <option value="mid">Medium (11-50 lawyers)</option>
          <option value="large">Large (51-200 lawyers)</option>
          <option value="enterprise">Enterprise (200+ lawyers)</option>
        </select>

        <details className="mb-6">
          <summary className="cursor-pointer text-xs text-[#8a7c68]">
            Firm details (optional)
          </summary>

          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs text-[#8a7c68]">
                Bar council registration number
              </label>
              <input
                value={barRegistrationNumber}
                onChange={(event) => setBarRegistrationNumber(event.target.value)}
                className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[#8a7c68]">Practice areas</label>
              <input
                value={practiceAreas}
                onChange={(event) => setPracticeAreas(event.target.value)}
                placeholder="Corporate, Civil, Family"
                className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[#8a7c68]">Number of employees</label>
                <input
                  type="number"
                  min={0}
                  value={employeeCount}
                  onChange={(event) => setEmployeeCount(Number(event.target.value))}
                  className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[#8a7c68]">Number of lawyers</label>
                <input
                  type="number"
                  min={0}
                  value={lawyerCount}
                  onChange={(event) => setLawyerCount(Number(event.target.value))}
                  className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[#8a7c68]">Office location(s)</label>
              <input
                value={officeLocations}
                onChange={(event) => setOfficeLocations(event.target.value)}
                className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[#8a7c68]">Firm address</label>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[#8a7c68]">Phone</label>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[#8a7c68]">Website</label>
                <input
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[#8a7c68]">
                Official email domain
              </label>
              <input
                value={officialEmailDomain}
                onChange={(event) => setOfficialEmailDomain(event.target.value)}
                placeholder="e.g. yourfirm.com"
                className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[#8a7c68]">GST number</label>
              <input
                value={gstNumber}
                onChange={(event) => setGstNumber(event.target.value)}
                className="w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
              />
            </div>
          </div>
        </details>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#c9a96e] py-2 font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Sign up"}
        </button>

        <p className="mt-4 text-center text-sm text-[#8a7c68]">
          Not part of a law firm?{" "}
          <Link href="/register-public" className="text-[#c9a96e] hover:underline">
            Continue as a public user
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
