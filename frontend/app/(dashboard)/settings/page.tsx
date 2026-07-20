"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  clearDriveFolder,
  connectDrive,
  disconnectDrive,
  getDriveStatus,
  getFirmProfile,
  setDriveFolder,
  syncDrive,
  updateFirmProfile,
  uploadFirmLogo,
  REGIONS,
  type DriveStatus,
  type FirmProfile,
} from "@/lib/api";

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [firmProfile, setFirmProfile] = useState<FirmProfile | null>(null);
  const [editingFirm, setEditingFirm] = useState(false);
  const [savingFirm, setSavingFirm] = useState(false);
  const [firmError, setFirmError] = useState<string | null>(null);
  const [firmNotice, setFirmNotice] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [firmName, setFirmName] = useState("");
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

  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [driveNotice, setDriveNotice] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [folderLinkInput, setFolderLinkInput] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fillForm = (profile: FirmProfile) => {
    setFirmName(profile.name);
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
  };

  const loadFirmProfile = () => {
    getFirmProfile().then((profile) => {
      setFirmProfile(profile);
      fillForm(profile);
    });
  };

  const loadDriveStatus = () => {
    getDriveStatus()
      .then(setDriveStatus)
      .catch(() => {});
  };

  useEffect(() => {
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
  }, []);

  const handleSaveFirmProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingFirm(true);
    setFirmError(null);
    setFirmNotice(null);

    try {
      const updated = await updateFirmProfile({
        name: firmName,
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
      fillForm(updated);
      setEditingFirm(false);
      setFirmNotice("Firm settings saved.");
    } catch (err: any) {
      setFirmError(err?.response?.data?.error || "Failed to save firm settings.");
    } finally {
      setSavingFirm(false);
    }
  };

  const handleUploadLogo = async (file: File) => {
    setUploadingLogo(true);
    setFirmError(null);

    try {
      const updated = await uploadFirmLogo(file);
      setFirmProfile(updated);
    } catch (err: any) {
      setFirmError(err?.response?.data?.error || "Failed to upload logo.");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
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

  const inputClass =
    "rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Settings</h1>
        <p className="mt-1 text-sm text-[#8a7c68]">
          Your firm&apos;s profile, branding, and integrations — all in one place.
        </p>
      </div>

      {!isAdmin && (
        <p className="text-sm text-[#5a4f3f]">
          Only firm admins can change these settings. You can view them below.
        </p>
      )}

      {/* Firm profile */}
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
              <div>
                <h2 className="font-semibold text-[#f0e6cc]">Firm profile</h2>
                <p className="text-xs text-[#5a4f3f]">{firmProfile.name}</p>
              </div>
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
                  onClick={() => {
                    if (editingFirm && firmProfile) fillForm(firmProfile);
                    setEditingFirm((prev) => !prev);
                    setFirmError(null);
                  }}
                  className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#c9a96e]"
                >
                  {editingFirm ? "Cancel" : "Edit"}
                </button>
              </div>
            )}
          </div>

          {firmNotice && !editingFirm && (
            <div className="mb-3 rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
              {firmNotice}
            </div>
          )}
          {firmError && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {firmError}
            </div>
          )}

          {editingFirm ? (
            <form onSubmit={handleSaveFirmProfile} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Firm name</label>
                <input value={firmName} onChange={(e) => setFirmName(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Bar registration number</label>
                <input value={firmBarNumber} onChange={(e) => setFirmBarNumber(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Address</label>
                <input value={firmAddress} onChange={(e) => setFirmAddress(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Official email domain</label>
                <input value={firmEmailDomain} onChange={(e) => setFirmEmailDomain(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Practice areas</label>
                <input
                  value={firmPracticeAreas}
                  onChange={(e) => setFirmPracticeAreas(e.target.value)}
                  placeholder="Corporate, Civil, Family"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Employee count</label>
                <input
                  type="number"
                  min={0}
                  value={firmEmployeeCount}
                  onChange={(e) => setFirmEmployeeCount(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Lawyer count</label>
                <input
                  type="number"
                  min={0}
                  value={firmLawyerCount}
                  onChange={(e) => setFirmLawyerCount(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Office locations</label>
                <input value={firmOfficeLocations} onChange={(e) => setFirmOfficeLocations(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Phone</label>
                <input value={firmPhone} onChange={(e) => setFirmPhone(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Website</label>
                <input value={firmWebsite} onChange={(e) => setFirmWebsite(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">GST number</label>
                <input value={firmGstNumber} onChange={(e) => setFirmGstNumber(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Default web search region</label>
                <select
                  value={firmDefaultRegion}
                  onChange={(e) => setFirmDefaultRegion(e.target.value)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
                >
                  {REGIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingFirm}
                  className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
                >
                  {savingFirm ? "Saving..." : "Save"}
                </button>
              </div>
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
                <span className="text-[#5a4f3f]">({firmProfile.active_lawyer_count} active accounts)</span>
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
                <span className="text-[#5a4f3f]">GST number:</span> {firmProfile.gst_number || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Address:</span> {firmProfile.address || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Email domain:</span>{" "}
                {firmProfile.official_email_domain || "Not set"}
              </p>
              <p>
                <span className="text-[#5a4f3f]">Default web search region:</span>{" "}
                {REGIONS.find((r) => r.value === firmProfile.default_region)?.label || firmProfile.default_region}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Google Drive */}
      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-[#f0e6cc]">Google Drive</h2>
          {driveStatus?.connected && (
            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">Connected</span>
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
              Connect a Google Drive folder so the AI can search its PDFs alongside your uploaded
              documents when answering questions.
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
    </div>
  );
}
