"use client";

import { useEffect, useRef, useState } from "react";
import {
  changePassword,
  fetchMe,
  getFirmProfile,
  updateFirmProfile,
  updateMe,
  uploadFirmLogo,
  REGIONS,
  type FirmProfile,
  type MeProfile,
} from "@/lib/api";
import {
  ErrorNotice,
  Field,
  Notice,
  SettingsCard,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
} from "./ui";

export default function ProfileTab({ isAdmin }: { isAdmin: boolean }) {
  // --- Personal details ---
  const [me, setMe] = useState<MeProfile | null>(null);
  const [editingMe, setEditingMe] = useState(false);
  const [savingMe, setSavingMe] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [meNotice, setMeNotice] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");

  // --- Change password ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  // --- Firm profile ---
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

  const fillMeForm = (profile: MeProfile) => {
    setFirstName(profile.first_name);
    setLastName(profile.last_name);
    setEmail(profile.email);
    setDepartment(profile.department);
  };

  const fillFirmForm = (profile: FirmProfile) => {
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

  useEffect(() => {
    fetchMe()
      .then((profile) => {
        setMe(profile);
        fillMeForm(profile);
      })
      .catch(() => setMeError("Failed to load your profile."));

    getFirmProfile()
      .then((profile) => {
        setFirmProfile(profile);
        fillFirmForm(profile);
      })
      .catch(() => setFirmError("Failed to load the firm profile."));
  }, []);

  const handleSaveMe = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingMe(true);
    setMeError(null);
    setMeNotice(null);

    try {
      const updated = await updateMe({
        first_name: firstName,
        last_name: lastName,
        email,
        department,
      });
      setMe(updated);
      fillMeForm(updated);
      setEditingMe(false);
      setMeNotice("Personal details saved.");
    } catch (err: any) {
      setMeError(err?.response?.data?.error || "Failed to save personal details.");
    } finally {
      setSavingMe(false);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordNotice(null);

    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice("Password changed.");
    } catch (err: any) {
      setPasswordError(err?.response?.data?.error || "Failed to change password.");
    } finally {
      setChangingPassword(false);
    }
  };

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
      fillFirmForm(updated);
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

  return (
    <div className="flex flex-col gap-6">
      {/* Personal details */}
      <SettingsCard
        title="Personal details"
        subtitle={me ? `@${me.username}` : undefined}
        actions={
          me && (
            <button
              onClick={() => {
                if (editingMe) fillMeForm(me);
                setEditingMe((prev) => !prev);
                setMeError(null);
              }}
              className={secondaryButtonClass}
            >
              {editingMe ? "Cancel" : "Edit"}
            </button>
          )
        }
      >
        {meNotice && !editingMe && <Notice>{meNotice}</Notice>}
        {meError && <ErrorNotice>{meError}</ErrorNotice>}

        {!me ? (
          <p className="text-sm text-[#8a7c68]">Loading your profile...</p>
        ) : editingMe ? (
          <form onSubmit={handleSaveMe} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Field label="First name">
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Last name">
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
            </Field>
            <Field label="Department">
              <input value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} />
            </Field>
            <div className="flex items-end">
              <button type="submit" disabled={savingMe} className={primaryButtonClass}>
                {savingMe ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <div className="grid gap-2 text-sm text-[#8a7c68] sm:grid-cols-3">
            <p>
              <span className="text-[#5a4f3f]">Name:</span> {me.full_name}
            </p>
            <p>
              <span className="text-[#5a4f3f]">Email:</span> {me.email || "Not set"}
            </p>
            <p>
              <span className="text-[#5a4f3f]">Department:</span> {me.department || "Not set"}
            </p>
            <p>
              <span className="text-[#5a4f3f]">Role:</span> {me.role}
            </p>
            <p>
              <span className="text-[#5a4f3f]">Firm:</span> {me.firm_name}
            </p>
            <p>
              <span className="text-[#5a4f3f]">Member since:</span>{" "}
              {new Date(me.date_joined).toLocaleDateString()}
            </p>
          </div>
        )}
      </SettingsCard>

      {/* Change password */}
      <SettingsCard
        title="Password"
        subtitle="Change the password you use to sign in."
      >
        {passwordNotice && <Notice>{passwordNotice}</Notice>}
        {passwordError && <ErrorNotice>{passwordError}</ErrorNotice>}

        <form onSubmit={handleChangePassword} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Field label="Current password">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>
          <button type="submit" disabled={changingPassword} className={primaryButtonClass}>
            {changingPassword ? "Changing..." : "Change password"}
          </button>
        </form>
      </SettingsCard>

      {/* Firm profile */}
      {firmProfile && (
        <SettingsCard
          title="Firm profile"
          subtitle={firmProfile.name}
          actions={
            <div className="flex items-center gap-2">
              {firmProfile.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={firmProfile.logo_url}
                  alt="Firm logo"
                  className="h-10 w-10 rounded-lg object-cover"
                />
              )}
              {isAdmin && (
                <>
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
                    className={secondaryButtonClass}
                  >
                    {uploadingLogo ? "Uploading..." : "Upload logo"}
                  </button>
                  <button
                    onClick={() => {
                      if (editingFirm && firmProfile) fillFirmForm(firmProfile);
                      setEditingFirm((prev) => !prev);
                      setFirmError(null);
                    }}
                    className={secondaryButtonClass}
                  >
                    {editingFirm ? "Cancel" : "Edit"}
                  </button>
                </>
              )}
            </div>
          }
        >
          {!isAdmin && (
            <p className="mb-3 text-xs text-[#5a4f3f]">
              Only firm admins can change the firm profile. You can view it below.
            </p>
          )}
          {firmNotice && !editingFirm && <Notice>{firmNotice}</Notice>}
          {firmError && <ErrorNotice>{firmError}</ErrorNotice>}

          {editingFirm ? (
            <form onSubmit={handleSaveFirmProfile} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Field label="Firm name">
                <input value={firmName} onChange={(e) => setFirmName(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Bar registration number">
                <input value={firmBarNumber} onChange={(e) => setFirmBarNumber(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Address">
                <input value={firmAddress} onChange={(e) => setFirmAddress(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Official email domain">
                <input value={firmEmailDomain} onChange={(e) => setFirmEmailDomain(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Practice areas">
                <input
                  value={firmPracticeAreas}
                  onChange={(e) => setFirmPracticeAreas(e.target.value)}
                  placeholder="Corporate, Civil, Family"
                  className={inputClass}
                />
              </Field>
              <Field label="Employee count">
                <input
                  type="number"
                  min={0}
                  value={firmEmployeeCount}
                  onChange={(e) => setFirmEmployeeCount(Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
              <Field label="Lawyer count">
                <input
                  type="number"
                  min={0}
                  value={firmLawyerCount}
                  onChange={(e) => setFirmLawyerCount(Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
              <Field label="Office locations">
                <input value={firmOfficeLocations} onChange={(e) => setFirmOfficeLocations(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Phone">
                <input value={firmPhone} onChange={(e) => setFirmPhone(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Website">
                <input value={firmWebsite} onChange={(e) => setFirmWebsite(e.target.value)} className={inputClass} />
              </Field>
              <Field label="GST number">
                <input value={firmGstNumber} onChange={(e) => setFirmGstNumber(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Default web search region">
                <select
                  value={firmDefaultRegion}
                  onChange={(e) => setFirmDefaultRegion(e.target.value)}
                  className={selectClass}
                >
                  {REGIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end">
                <button type="submit" disabled={savingFirm} className={primaryButtonClass}>
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
        </SettingsCard>
      )}
    </div>
  );
}
