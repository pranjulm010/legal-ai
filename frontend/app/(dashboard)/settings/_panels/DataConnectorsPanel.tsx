"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  clearDriveFolder,
  connectDrive,
  disconnectDrive,
  getDriveStatus,
  setDriveFolder,
  syncDrive,
  type DriveStatus,
} from "@/lib/api";

export default function DataConnectorsPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [driveNotice, setDriveNotice] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [folderLinkInput, setFolderLinkInput] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadDriveStatus = () => {
    getDriveStatus()
      .then(setDriveStatus)
      .catch(() => {});
  };

  useEffect(() => {
    loadDriveStatus();

    const params = new URLSearchParams(window.location.search);
    if (params.get("drive_connected")) {
      setDriveNotice("Google Drive connected. Now link a folder to sync.");
      window.history.replaceState({}, "", window.location.pathname + "?tab=data-connectors");
    } else if (params.get("drive_error")) {
      setDriveError(`Google Drive connection failed: ${params.get("drive_error")}`);
      window.history.replaceState({}, "", window.location.pathname + "?tab=data-connectors");
    }
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Data Connectors</h1>
        <p className="text-sm text-[#8a7c68]">
          Connect external storage so the AI can search those files alongside your uploads.
        </p>
      </div>

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">📁</span>
            <h2 className="font-semibold text-[#f0e6cc]">Google Drive</h2>
          </div>
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
