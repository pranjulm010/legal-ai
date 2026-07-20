"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import {
  createContact,
  deleteContact,
  importContactsCsv,
  listContacts,
  type Contact,
  type ContactImportResult,
} from "@/lib/api";

export default function ContactsPage() {
  const { user, permissions } = useAuth();
  const canManage = hasPermission(user?.role, "manage_contacts", permissions);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    listContacts()
      .then(setContacts)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      await createContact({ name, email, phone, notes });
      setName("");
      setEmail("");
      setPhone("");
      setNotes("");
      setShowForm(false);
      load();
    } catch (err: any) {
      setFormError(err?.response?.data?.error || "Failed to create contact.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (contactId: number) => {
    await deleteContact(contactId);
    load();
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportResult(null);

    try {
      const result = await importContactsCsv(file);
      setImportResult(result);
      load();
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Contacts</h1>

        {canManage && (
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleImport(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="rounded-lg border border-[#c9a96e]/15 px-4 py-2 text-sm text-[#c9a96e] disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import CSV"}
            </button>
            <button
              onClick={() => setShowForm((prev) => !prev)}
              className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
            >
              {showForm ? "Cancel" : "+ Add contact"}
            </button>
          </div>
        )}
      </div>

      {!canManage && (
        <p className="text-sm text-[#5a4f3f]">
          Your role doesn't have permission to add or import contacts. You can view the list below.
        </p>
      )}

      <p className="text-xs text-[#5a4f3f]">
        CSV format: a header row with <code>name</code> (required), and optional{" "}
        <code>email</code>, <code>phone</code>, <code>notes</code> columns.
      </p>

      {importResult && (
        <div className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4 text-sm">
          <p className="text-[#e0d2ba]">
            Imported {importResult.created} contact(s), skipped {importResult.skipped}.
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

      {showForm && canManage && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Name</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Email</label>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Phone</label>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Notes</label>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
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

          {formError && <p className="w-full text-sm text-red-300">{formError}</p>}
        </form>
      )}

      {loading ? (
        <p className="text-[#8a7c68]">Loading contacts...</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-[#5a4f3f]">No contacts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex items-center justify-between rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] px-4 py-3"
            >
              <div>
                <p className="font-medium text-[#e0d2ba]">{contact.name}</p>
                <p className="text-xs text-[#8a7c68]">
                  {[contact.email, contact.phone].filter(Boolean).join(" · ") || "No contact details"}
                  {contact.case_title && ` · ${contact.case_title}`}
                </p>
              </div>

              {canManage && (
                <button
                  onClick={() => handleDelete(contact.id)}
                  className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
