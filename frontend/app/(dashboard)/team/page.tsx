"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  connectDrive,
  createLawyer,
  disconnectDrive,
  getDriveStatus,
  getFirmProfile,
  importLawyersCsv,
  listLawyers,
  removeLawyer,
  resendInvite,
  clearDriveFolder,
  setDriveFolder,
  syncDrive,
  updateFirmProfile,
  updateLawyer,
  uploadFirmLogo,
  REGIONS,
  type DriveStatus,
  type FirmProfile,
  type LawyerImportResult,
  type LawyerListItem,
} from "@/lib/api";

const ROLES = ["admin", "partner", "associate", "paralegal"];

export default function TeamPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [firmProfile, setFirmProfile] = useState<FirmProfile | null>(null);
  const [editingFirm, setEditingFirm] = useState(false);
  const [firmBarNumber, setFirmBarNumber] = useState("");
  const [firmAddress, setFirmAddress] = useState("");
  const [firmEmailDomain, setFirmEmailDomain] = useState("");
  const [firmPracticeAreas, setFirmPracticeAreas] = useState("");
  const [firmEmployeeCount, setFirmEmployeeCount] = useState(0);
  const [firmLawyerCount, setFirmLawyerCount] = useState(0);
  const [firmOfficeLocations, setFirmOfficeLocations] = useState("");
  const [firmPhone, setFirmPhone] = useState("");
  const [firmWebsite, setFirmWebsite] = useState("");
  const [firmGstNumber, setFirmGstNumber] = useState("");
  const [firmDefaultRegion, setFirmDefaultRegion] = useState("india");
  const [savingFirm, setSavingFirm] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [lawyers, setLawyers] = useState<LawyerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("associate");
  const [department, setDepartment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<LawyerImportResult | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [driveNotice, setDriveNotice] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [folderLinkInput, setFolderLinkInput] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = () => {
    setLoading(true);
    listLawyers()
      .then(setLawyers)
      .catch(() => setError("Failed to load team."))
      .finally(() => setLoading(false));
  };

  const loadFirmProfile = () => {
    getFirmProfile().then((profile) => {
      setFirmProfile(profile);
      setFirmBarNumber(profile.bar_registration_number);
      setFirmAddress(profile.address);
      setFirmEmailDomain(profile.official_email_domain);
      setFirmPracticeAreas(profile.practice_areas);
      setFirmEmployeeCount(profile.employee_count);
      setFirmLawyerCount(profile.lawyer_count);
      setFirmOfficeLocations(profile.office_locations);
      setFirmPhone(profile.phone);
      setFirmWebsite(profile.website);
      setFirmGstNumber(profile.gst_number);
      setFirmDefaultRegion(profile.default_region);
    });
  };

  const loadDriveStatus = () => {
    getDriveStatus()
      .then(setDriveStatus)
      .catch(() => {});
  };

  useEffect(() => {
    load();
    loadFirmProfile();
    loadDriveStatus();

    // Google redirects back here with ?drive_connected=1 or ?drive_error=...
    // after the OAuth consent screen - surface that as a one-time notice.
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive_connected")) {
      setDriveNotice("Google Drive connected. Now link a folder to sync.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("drive_error")) {
      setDriveError(`Google Drive connection failed: ${params.get("drive_error")}`);
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Invite completion (a lawyer setting their password) happens in a
    // different browser session, so this page's data goes stale the moment
    // that happens. Refetch whenever the admin comes back to this tab/page
    // instead of relying on a full reload.
    const handleFocus = () => load();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") load();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const handleSaveFirmProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingFirm(true);

    try {
      const updated = await updateFirmProfile({
        bar_registration_number: firmBarNumber,
        address: firmAddress,
        official_email_domain: firmEmailDomain,
        practice_areas: firmPracticeAreas,
        employee_count: firmEmployeeCount,
        lawyer_count: firmLawyerCount,
        office_locations: firmOfficeLocations,
        phone: firmPhone,
        website: firmWebsite,
        gst_number: firmGstNumber,
        default_region: firmDefaultRegion,
      });
      setFirmProfile(updated);
      setEditingFirm(false);
    } finally {
      setSavingFirm(false);
    }
  };

  const handleUploadLogo = async (file: File) => {
    setUploadingLogo(true);

    try {
      const updated = await uploadFirmLogo(file);
      setFirmProfile(updated);
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setInviteNotice(null);

    try {
      const result = await createLawyer({
        username,
        email,
        first_name: firstName,
        last_name: lastName,
        role,
        department,
      });
      setUsername("");
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("associate");
      setDepartment("");
      setShowForm(false);
      setInviteNotice(
        result.email_sent
          ? `Invite sent to ${result.email}.`
          : `Could not send the invite email. Share this link manually: ${result.invite_link}`
      );
      load();
    } catch (err: any) {
      setFormError(err?.response?.data?.error || "Failed to create lawyer.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (lawyerId: number, newRole: string) => {
    try {
      await updateLawyer(lawyerId, { role: newRole });
      load();
    } catch (err: any) {
      const message = err?.response?.data?.error || "Failed to change role.";

      if (!message.includes("successor_id")) {
        alert(message);
        return;
      }

      const successorUsername = window.prompt(
        `${message}\n\nType the exact username of the lawyer who should become the new admin:`
      );
      if (!successorUsername) return;

      const successor = lawyers.find(
        (l) => l.username.toLowerCase() === successorUsername.trim().toLowerCase()
      );
      if (!successor) {
        alert("No lawyer found with that username.");
        return;
      }

      try {
        await updateLawyer(lawyerId, { role: newRole, successor_id: successor.id });
        load();
      } catch (err2: any) {
        alert(err2?.response?.data?.error || "Failed to change role.");
      }
    }
  };

  const handleConnectDrive = async () => {
    setConnectingDrive(true);
    setDriveError(null);

    try {
      const { auth_url } = await connectDrive();
      window.location.href = auth_url;
    } catch (err: any) {
      setDriveError(err?.response?.data?.error || "Failed to start Google Drive connection.");
      setConnectingDrive(false);
    }
  };

  const handleSetFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingFolder(true);
    setDriveError(null);
    setDriveNotice(null);

    try {
      const status = await setDriveFolder(folderLinkInput);
      setDriveStatus(status);
      setFolderLinkInput("");
      setDriveNotice(`Linked folder "${status.folder_name}". Click "Sync now" to index its PDFs.`);
    } catch (err: any) {
      setDriveError(err?.response?.data?.error || "Failed to link that folder.");
    } finally {
      setSavingFolder(false);
    }
  };

  const handleClearFolder = async () => {
    setDriveError(null);
    setDriveNotice(null);

    try {
      const status = await clearDriveFolder();
      setDriveStatus(status);
      setDriveNotice("Folder scope cleared - syncing will now search your whole Drive.");
    } catch (err: any) {
      setDriveError(err?.response?.data?.error || "Failed to clear folder scope.");
    }
  };

  const handleSyncDrive = async () => {
    setSyncing(true);
    setDriveError(null);
    setDriveNotice(null);

    try {
      const result = await syncDrive();
      setDriveNotice(
        `Synced ${result.synced} new, ${result.updated} updated, ${result.skipped} unchanged.` +
          (result.errors.length ? ` ${result.errors.length} error(s).` : "")
      );
      loadDriveStatus();
    } catch (err: any) {
      setDriveError(err?.response?.data?.error || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnectDrive = async () => {
    if (!confirm("Disconnect Google Drive? Already-indexed documents will stay searchable, but syncing will stop.")) {
      return;
    }

    await disconnectDrive();
    setDriveStatus({ connected: false });
    setDriveNotice("Google Drive disconnected.");
  };

  const handleToggleActive = async (lawyer: LawyerListItem) => {
    await updateLawyer(lawyer.id, { is_active: !lawyer.is_active });
    load();
  };

  const handleRemove = async (lawyer: LawyerListItem) => {
    if (!confirm(`Remove ${lawyer.full_name}? This cannot be undone.`)) return;
    await removeLawyer(lawyer.id);
    load();
  };

  const handleResendInvite = async (lawyer: LawyerListItem) => {
    setResendingId(lawyer.id);
    setInviteNotice(null);

    try {
      const result = await resendInvite(lawyer.id);
      setInviteNotice(
        result.email_sent
          ? `Invite re-sent to ${result.email}.`
          : `Could not send the invite email. Share this link manually: ${result.invite_link}`
      );
    } finally {
      setResendingId(null);
    }
  };

  const handleImportCsv = async (file: File) => {
    setImporting(true);
    setImportResult(null);

    try {
      const result = await importLawyersCsv(file);
      setImportResult(result);
      load();
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {firmProfile && (
        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {firmProfile.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={firmProfile.logo_url}
                  alt="Firm logo"
                  className="h-10 w-10 rounded-lg object-cover"
                />
              )}
              <h2 className="font-semibold text-[#f0e6cc]">Firm profile</h2>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleUploadLogo(file);
                  }}
                />
                <button
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#c9a96e] disabled:opacity-50"
                >
                  {uploadingLogo ? "Uploading..." : "Upload logo"}
                </button>
                <button
                  onClick={() => setEditingFirm((prev) => !prev)}
                  className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#c9a96e]"
                >
                  {editingFirm ? "Cancel" : "Edit"}
                </button>
              </div>
            )}
          </div>

          {editingFirm ? (
            <form onSubmit={handleSaveFirmProfile} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Bar registration number</label>
                <input
                  value={firmBarNumber}
                  onChange={(event) => setFirmBarNumber(event.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Address</label>
                <input
                  value={firmAddress}
                  onChange={(event) => setFirmAddress(event.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Official email domain</label>
                <input
                  value={firmEmailDomain}
                  onChange={(event) => setFirmEmailDomain(event.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Practice areas</label>
                <input
                  value={firmPracticeAreas}
                  onChange={(event) => setFirmPracticeAreas(event.target.value)}
                  placeholder="Corporate, Civil, Family"
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Employee count</label>
                <input
                  type="number"
                  min={0}
                  value={firmEmployeeCount}
                  onChange={(event) => setFirmEmployeeCount(Number(event.target.value))}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Lawyer count</label>
                <input
                  type="number"
                  min={0}
                  value={firmLawyerCount}
                  onChange={(event) => setFirmLawyerCount(Number(event.target.value))}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Office locations</label>
                <input
                  value={firmOfficeLocations}
                  onChange={(event) => setFirmOfficeLocations(event.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Phone</label>
                <input
                  value={firmPhone}
                  onChange={(event) => setFirmPhone(event.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Website</label>
                <input
                  value={firmWebsite}
                  onChange={(event) => setFirmWebsite(event.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">GST number</label>
                <input
                  value={firmGstNumber}
                  onChange={(event) => setFirmGstNumber(event.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Default web search region</label>
                <select
                  value={firmDefaultRegion}
                  onChange={(event) => setFirmDefaultRegion(event.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
                >
                  {REGIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={savingFirm}
                className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
              >
                {savingFirm ? "Saving..." : "Save"}
              </button>
            </form>
          ) : (
            <div className="grid gap-2 text-sm text-[#8a7c68] sm:grid-cols-3">
              <p>
                <span className="text-[#5a4f3f]">Bar reg. number:</span>{" "}
                {firmProfile.bar_registration_number || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Practice areas:</span>{" "}
                {firmProfile.practice_areas || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Employees / Lawyers:</span>{" "}
                {firmProfile.employee_count} / {firmProfile.lawyer_count}{" "}
                <span className="text-[#5a4f3f]">
                  ({firmProfile.active_lawyer_count} active accounts)
                </span>
              </p>
              <p>
                <span className="text-[#5a4f3f]">Office locations:</span>{" "}
                {firmProfile.office_locations || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Phone:</span> {firmProfile.phone || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Website:</span> {firmProfile.website || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">GST number:</span>{" "}
                {firmProfile.gst_number || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Address:</span>{" "}
                {firmProfile.address || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Email domain:</span>{" "}
                {firmProfile.official_email_domain || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Default web search region:</span>{" "}
                {REGIONS.find((r) => r.value === firmProfile.default_region)?.label ||
                  firmProfile.default_region}
              </p>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-[#f0e6cc]">Google Drive</h2>
          {driveStatus?.connected && (
            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
              Connected
            </span>
          )}
        </div>

        {driveNotice && (
          <div className="mb-3 rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
            {driveNotice}
          </div>
        )}
        {driveError && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {driveError}
          </div>
        )}

        {!driveStatus?.connected ? (
          <div>
            <p className="mb-3 text-sm text-[#8a7c68]">
              Connect a Google Drive folder so the AI can search its PDFs alongside your
              uploaded documents when answering questions.
            </p>
            {isAdmin ? (
              <button
                onClick={handleConnectDrive}
                disabled={connectingDrive}
                className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
              >
                {connectingDrive ? "Redirecting to Google..." : "Connect Google Drive"}
              </button>
            ) : (
              <p className="text-xs text-[#5a4f3f]">Only a firm admin can connect Google Drive.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#c9a96e]/12 px-3 py-2 text-sm">
              <div>
                {driveStatus.folder_id ? (
                  <p className="text-[#e0d2ba]">
                    📁{" "}
                    <a
                      href={driveStatus.folder_link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#c9a96e] hover:underline"
                    >
                      {driveStatus.folder_name}
                    </a>{" "}
                    <span className="text-xs text-[#5a4f3f]">(scoped to this folder)</span>
                  </p>
                ) : (
                  <p className="text-[#e0d2ba]">📂 Searching your whole Drive (no folder scoping)</p>
                )}
                <p className="text-xs text-[#5a4f3f]">
                  {driveStatus.last_synced_at
                    ? `Last synced ${new Date(driveStatus.last_synced_at).toLocaleString()}`
                    : "Not synced yet"}
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={handleSyncDrive}
                  disabled={syncing}
                  className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#c9a96e] disabled:opacity-50"
                >
                  {syncing ? "Syncing..." : "Sync now"}
                </button>
              )}
            </div>

            {isAdmin && (
              <form onSubmit={handleSetFolder} className="flex flex-wrap items-end gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-xs text-[#8a7c68]">
                    {driveStatus.folder_id
                      ? "Change folder (paste a Drive folder link) - or clear it to search your whole Drive again"
                      : "Optional: paste a Drive folder link to narrow syncing to just that folder"}
                  </label>
                  <input
                    value={folderLinkInput}
                    onChange={(event) => setFolderLinkInput(event.target.value)}
                    placeholder="https://drive.google.com/drive/folders/..."
                    required
                    className="min-w-[260px] flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingFolder}
                  className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
                >
                  {savingFolder ? "Linking..." : "Link folder"}
                </button>
                {driveStatus.folder_id && (
                  <button
                    type="button"
                    onClick={handleClearFolder}
                    className="rounded-lg border border-[#c9a96e]/15 px-3 py-2 text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                  >
                    Clear folder scope
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDisconnectDrive}
                  className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                >
                  Disconnect
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Team</h1>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[#c9a96e]/15 px-4 py-2 text-sm text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {isAdmin && (
            <>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleImportCsv(file);
              }}
            />
            <button
              onClick={() => csvInputRef.current?.click()}
              disabled={importing}
              className="rounded-lg border border-[#c9a96e]/15 px-4 py-2 text-sm text-[#c9a96e] disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import CSV"}
            </button>
            <button
              onClick={() => setShowForm((prev) => !prev)}
              className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
            >
              {showForm ? "Cancel" : "+ Add lawyer"}
            </button>
            </>
          )}
        </div>
      </div>

      {!isAdmin && (
        <p className="text-sm text-[#5a4f3f]">
          Only firm admins can add lawyers or change roles. You can view the team below.
        </p>
      )}

      {isAdmin && (
        <p className="text-xs text-[#5a4f3f]">
          CSV format: a header row with <code>username</code> and <code>email</code> (required),
          and optional <code>first_name</code>, <code>last_name</code>, <code>role</code>,{" "}
          <code>department</code> columns.
        </p>
      )}

      {importResult && (
        <div className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4 text-sm">
          <p className="text-[#e0d2ba]">
            Imported {importResult.created} lawyer(s), skipped {importResult.skipped}.
          </p>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-[#8a7c68]">
              {importResult.errors.map((err, index) => (
                <li key={index}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {inviteNotice && (
        <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
          {inviteNotice}
        </div>
      )}

      {showForm && isAdmin && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Username</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">First name</label>
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Last name</label>
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Role</label>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Department</label>
            <input
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>

          {formError && (
            <p className="w-full text-sm text-red-300">{formError}</p>
          )}
        </form>
      )}

      {error && <p className="text-red-300">{error}</p>}

      {loading ? (
        <p className="text-[#8a7c68]">Loading team...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lawyers.map((lawyer) => (
            <li
              key={lawyer.id}
              className="flex items-center justify-between rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] px-4 py-3"
            >
              <div>
                <p className="font-medium text-[#e0d2ba]">
                  {lawyer.full_name}{" "}
                  <span className="text-xs text-[#5a4f3f]">@{lawyer.username}</span>
                  {lawyer.invite_pending && (
                    <span className="ml-2 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-400">
                      Invite pending
                    </span>
                  )}
                </p>
                <p className="text-xs text-[#8a7c68]">
                  {lawyer.email} · {lawyer.is_active ? "Active" : "Deactivated"}
                  {lawyer.department && ` · ${lawyer.department}`}
                </p>
              </div>

              {isAdmin ? (
                <div className="flex items-center gap-2">
                  {lawyer.invite_pending && (
                    <button
                      onClick={() => handleResendInvite(lawyer)}
                      disabled={resendingId === lawyer.id}
                      className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
                    >
                      {resendingId === lawyer.id ? "Sending..." : "Resend invite"}
                    </button>
                  )}
                  <select
                    value={lawyer.role}
                    onChange={(event) => handleRoleChange(lawyer.id, event.target.value)}
                    className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-2 py-1 text-xs text-[#e0d2ba]"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleToggleActive(lawyer)}
                    className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                  >
                    {lawyer.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                  <button
                    onClick={() => handleRemove(lawyer)}
                    className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <span className="text-xs text-[#8a7c68]">{lawyer.role}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
