"use client";

import { useEffect, useState } from "react";
import {
  clearDriveFolder,
  connectDrive,
  disconnectDrive,
  getDriveStatus,
  setDriveFolder,
  syncDrive,
  type DriveStatus,
} from "@/lib/api";
import {
  Badge,
  ErrorNotice,
  Notice,
  SettingsCard,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

export default function DriveTab({ isAdmin }: { isAdmin: boolean }) {
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [driveNotice, setDriveNotice] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [folderLinkInput, setFolderLinkInput] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadDriveStatus = () => {
    getDriveStatus()
      .then(setDriveStatus)
      .catch(() => setDriveError("Failed to load Google Drive status."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDriveStatus();

    // Google redirects back to /settings with ?drive_connected=1 or
    // ?drive_error=... after the OAuth consent screen - surface that as a
    // one-time notice (the settings page keeps ?tab=drive in the URL).
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive_connected")) {
      setDriveNotice("Google Drive connected. Now link a folder to sync.");
      window.history.replaceState({}, "", `${window.location.pathname}?tab=drive`);
    } else if (params.get("drive_error")) {
      setDriveError(`Google Drive connection failed: ${params.get("drive_error")}`);
      window.history.replaceState({}, "", `${window.location.pathname}?tab=drive`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <SettingsCard
      title="Google Drive"
      subtitle="Sync a shared Drive folder so its PDFs are searchable alongside your uploaded documents."
      actions={
        driveStatus?.connected ? (
          <Badge tone="green">Connected</Badge>
        ) : loading ? undefined : (
          <Badge tone="muted">Not connected</Badge>
        )
      }
    >
      {driveNotice && <Notice>{driveNotice}</Notice>}
      {driveError && <ErrorNotice>{driveError}</ErrorNotice>}

      {loading ? (
        <p className="text-sm text-[#8a7c68]">Loading Google Drive status...</p>
      ) : !driveStatus?.connected ? (
        <div>
          <p className="mb-3 text-sm text-[#8a7c68]">
            Connect a Google Drive folder so the AI can search its PDFs alongside your uploaded
            documents when answering questions.
          </p>
          {isAdmin ? (
            <button
              onClick={handleConnectDrive}
              disabled={connectingDrive}
              className={primaryButtonClass}
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
                className={secondaryButtonClass}
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
              <button type="submit" disabled={savingFolder} className={primaryButtonClass}>
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
                className={dangerButtonClass}
              >
                Disconnect
              </button>
            </form>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
