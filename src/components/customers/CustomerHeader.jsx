import React, { useState, useEffect, useContext } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Phone, MapPin, Briefcase, Heart, Mail } from "lucide-react";
import { ThemeContext } from "@/Layout";
import CallNotePopup from "./CallNotePopup";

const CH_KANTONE = [
  { code: 'AG', name: 'Aargau' },         { code: 'AI', name: 'Appenzell Innerrhoden' },
  { code: 'AR', name: 'Appenzell Ausserrhoden' }, { code: 'BE', name: 'Bern' },
  { code: 'BL', name: 'Basel-Landschaft' }, { code: 'BS', name: 'Basel-Stadt' },
  { code: 'FR', name: 'Freiburg' },        { code: 'GE', name: 'Genf' },
  { code: 'GL', name: 'Glarus' },          { code: 'GR', name: 'Graubünden' },
  { code: 'JU', name: 'Jura' },            { code: 'LU', name: 'Luzern' },
  { code: 'NE', name: 'Neuenburg' },       { code: 'NW', name: 'Nidwalden' },
  { code: 'OW', name: 'Obwalden' },        { code: 'SG', name: 'St. Gallen' },
  { code: 'SH', name: 'Schaffhausen' },    { code: 'SO', name: 'Solothurn' },
  { code: 'SZ', name: 'Schwyz' },          { code: 'TG', name: 'Thurgau' },
  { code: 'TI', name: 'Tessin' },          { code: 'UR', name: 'Uri' },
  { code: 'VD', name: 'Waadt' },           { code: 'VS', name: 'Wallis' },
  { code: 'ZG', name: 'Zug' },             { code: 'ZH', name: 'Zürich' },
];

// ── Section divider with label ──────────────────────────────────────────────
function SectionLabel({ icon: Icon, label, color, lineColor }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Icon className="h-3 w-3 flex-shrink-0" style={{ color }} />
      <span className="text-[10px] font-semibold tracking-widest uppercase whitespace-nowrap" style={{ color }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: lineColor }} />
    </div>
  );
}

export default function CustomerHeader({ customer, staff, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';

  const isPrivatperson = customer.person_type === 'privatperson';
  const isInaktiv      = customer.aktiv === false;

  // Shared fields
  const [strasse,  setStrasse]  = useState(customer.strasse || "");
  const [plz,      setPlz]      = useState(customer.plz || "");
  const [ort,      setOrt]      = useState(customer.ort || "");
  const [phone,    setPhone]    = useState(customer.phone || "");
  const [email,    setEmail]    = useState(customer.email || "");
  const [budget,   setBudget]   = useState(
    customer.budget !== undefined && customer.budget !== null ? formatBudgetStatic(customer.budget) : ""
  );

  // Unternehmen
  const [companyName, setCompanyName] = useState(customer.company_name || "");

  // Privatperson
  const [anrede,         setAnrede]         = useState(customer.anrede || "");
  const [nachname,       setNachname]       = useState(customer.nachname || "");
  const [vorname,        setVorname]        = useState(customer.vorname || "");
  const [ahvNummer,      setAhvNummer]      = useState(customer.ahv_nummer || "");
  const [geburtsdatum,   setGeburtsdatum]   = useState(customer.geburtsdatum || "");
  const [partnerName,    setPartnerName]    = useState(customer.partner_name || "");
  const [partnerVorname, setPartnerVorname] = useState(customer.partner_vorname || "");

  // Kanton (beide Typen)
  const [kanton, setKanton] = useState(customer.kanton || "");

  // Call-Popup
  const [callOpen, setCallOpen] = useState(false);

  function formatBudgetStatic(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return "";
    return num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  useEffect(() => {
    setCompanyName(customer.company_name || "");
    setStrasse(customer.strasse || "");
    setPlz(customer.plz || "");
    setOrt(customer.ort || "");
    setPhone(customer.phone || "");
    setEmail(customer.email || "");
    setBudget(customer.budget !== undefined && customer.budget !== null ? formatBudgetStatic(customer.budget) : "");
    setAnrede(customer.anrede || "");
    setNachname(customer.nachname || "");
    setVorname(customer.vorname || "");
    setAhvNummer(customer.ahv_nummer || "");
    setGeburtsdatum(customer.geburtsdatum || "");
    setPartnerName(customer.partner_name || "");
    setPartnerVorname(customer.partner_vorname || "");
    setKanton(customer.kanton || "");
  }, [customer.id]);

  const handleBudgetBlur = () => {
    const num = parseFloat(budget.replace(/[^0-9.-]/g, ""));
    const val = isNaN(num) ? null : num;
    if (val !== customer.budget) onUpdate({ budget: val });
    setBudget(isNaN(num) ? "" : num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  };

  const handleNameBlur = () => {
    const trimmed = `${nachname} ${vorname}`.trim();
    const changed = nachname !== (customer.nachname || "") || vorname !== (customer.vorname || "");
    if (changed) {
      onUpdate({ nachname, vorname, company_name: trimmed || "Neue Person" });
    }
  };

  const handleAnredeChange = (val) => {
    setAnrede(val);
    if (val !== (customer.anrede || "")) onUpdate({ anrede: val });
  };

  // ── Theme tokens ───────────────────────────────────────────────────────────
  const inputBg      = '#ffffff';
  const borderColor  = isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db';
  const textColor    = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937';
  const placeholderC = isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#9ca3af';
  const labelColor   = isArtis ? '#6b826b' : isLight ? '#8080a0' : '#71717a';
  const lineColor    = isArtis ? '#d4e4d4' : isLight ? '#dcdcf0' : '#e4e4e7';
  const sectionColor = isArtis ? '#7a9b7a' : isLight ? '#9090b8' : '#71717a';

  const inputStyle = {
    backgroundColor: inputBg,
    borderColor,
    color: textColor,
  };
  const inputClass = `text-sm h-8 focus-visible:ring-violet-500`;
  const placeholderStyle = `placeholder:text-[${placeholderC}]`;

  // Shared input props helper
  const inp = (extraClass = "") => ({
    className: `${inputClass} ${extraClass}`,
    style: inputStyle,
  });

  return (
    <div className="p-5 space-y-4 border-b" style={{ borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>

      {/* ── NAME / FIRMENNAME + INAKTIV BADGE ─────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {isPrivatperson ? (
            /* Anrede | Nachname | Vorname — alles in einer Zeile */
            <div className="flex items-center gap-2">
              <select
                value={anrede}
                onChange={e => handleAnredeChange(e.target.value)}
                className="rounded-md border text-sm px-2 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-violet-500"
                style={{ ...inputStyle, height: 44, width: 84, fontSize: '0.85rem' }}
              >
                <option value="">Anrede</option>
                <option value="Herr">Herr</option>
                <option value="Frau">Frau</option>
              </select>
              <Input
                value={nachname}
                onChange={e => setNachname(e.target.value)}
                onBlur={handleNameBlur}
                className="text-2xl font-bold focus-visible:ring-violet-500 h-auto py-2 flex-1"
                style={inputStyle}
                placeholder="Nachname …"
              />
              <Input
                value={vorname}
                onChange={e => setVorname(e.target.value)}
                onBlur={handleNameBlur}
                className="text-xl font-semibold focus-visible:ring-violet-500 h-auto py-2 flex-1"
                style={{ ...inputStyle, color: isArtis ? '#3d5a3d' : isLight ? '#3a3a5a' : '#374151' }}
                placeholder="Vorname …"
              />
            </div>
          ) : (
            <Input
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              onBlur={() => { if (companyName !== customer.company_name) onUpdate({ company_name: companyName }); }}
              className="text-2xl font-bold focus-visible:ring-violet-500 h-auto py-2"
              style={inputStyle}
              placeholder="Firmenname …"
            />
          )}
        </div>

        {/* Inaktiv-Toggle */}
        <button
          onClick={() => onUpdate({ aktiv: isInaktiv ? true : false })}
          className={`flex-shrink-0 mt-2 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
            isInaktiv
              ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
              : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
          }`}
          title={isInaktiv ? 'Klicken um zu aktivieren' : 'Klicken um zu deaktivieren'}
        >
          {isInaktiv ? 'INAKTIV' : 'Aktiv'}
        </button>
      </div>

      {/* ── PERSON (nur Privatperson) ─────────────────────────────────────── */}
      {isPrivatperson && (
        <div className="space-y-2.5">
          <SectionLabel icon={User} label="Person" color={sectionColor} lineColor={lineColor} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>AHV-Nummer</label>
              <Input
                value={ahvNummer}
                onChange={e => setAhvNummer(e.target.value)}
                onBlur={() => { if (ahvNummer !== (customer.ahv_nummer || "")) onUpdate({ ahv_nummer: ahvNummer }); }}
                placeholder="756.XXXX.XXXX.XX"
                {...inp()}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>Geburtsdatum</label>
              <Input
                type="date"
                value={geburtsdatum}
                onChange={e => setGeburtsdatum(e.target.value)}
                onBlur={() => { if (geburtsdatum !== (customer.geburtsdatum || "")) onUpdate({ geburtsdatum: geburtsdatum || null }); }}
                {...inp()}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── PARTNER (nur Privatperson) ────────────────────────────────────── */}
      {isPrivatperson && (
        <div className="space-y-2.5">
          <SectionLabel icon={Heart} label="Ehe- / Lebenspartner" color={sectionColor} lineColor={lineColor} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>Nachname</label>
              <Input
                value={partnerName}
                onChange={e => setPartnerName(e.target.value)}
                onBlur={() => { if (partnerName !== (customer.partner_name || "")) onUpdate({ partner_name: partnerName || null }); }}
                placeholder="Partner Nachname"
                {...inp()}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>Vorname</label>
              <Input
                value={partnerVorname}
                onChange={e => setPartnerVorname(e.target.value)}
                onBlur={() => { if (partnerVorname !== (customer.partner_vorname || "")) onUpdate({ partner_vorname: partnerVorname || null }); }}
                placeholder="Partner Vorname"
                {...inp()}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── ADRESSE ───────────────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        <SectionLabel icon={MapPin} label="Adresse" color={sectionColor} lineColor={lineColor} />
        <div className="space-y-1">
          <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>Strasse</label>
          <Input
            value={strasse}
            onChange={e => setStrasse(e.target.value)}
            onBlur={() => { if (strasse !== customer.strasse) onUpdate({ strasse }); }}
            placeholder="Strasse und Hausnummer"
            autoComplete="off"
            {...inp()}
          />
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: '80px 1fr 160px' }}>
          <div className="space-y-1">
            <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>PLZ</label>
            <Input
              value={plz}
              onChange={e => setPlz(e.target.value)}
              onBlur={() => { if (plz !== customer.plz) onUpdate({ plz }); }}
              placeholder="PLZ"
              autoComplete="off"
              {...inp()}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>Ort</label>
            <Input
              value={ort}
              onChange={e => setOrt(e.target.value)}
              onBlur={() => { if (ort !== customer.ort) onUpdate({ ort }); }}
              placeholder="Ortschaft"
              autoComplete="off"
              {...inp()}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>Kanton</label>
            <Select
              value={kanton || "__none__"}
              onValueChange={v => {
                const val = v === "__none__" ? "" : v;
                setKanton(val);
                onUpdate({ kanton: val || null });
              }}
            >
              <SelectTrigger className="h-8 text-xs" style={inputStyle}>
                <SelectValue placeholder="— KT" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-gray-400">— Kanton</SelectItem>
                {CH_KANTONE.map(k => (
                  <SelectItem key={k.code} value={k.code} className="text-xs text-gray-800">
                    {k.code} – {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── KONTAKT ───────────────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        <SectionLabel icon={Phone} label="Kontakt & Budget" color={sectionColor} lineColor={lineColor} />
        <div className="flex gap-2">
          {/* Telefon */}
          <div className="flex items-center flex-1 gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>Telefon</label>
              <div className="flex items-center gap-2">
                <Input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  onBlur={() => { if (phone !== (customer.phone || "")) onUpdate({ phone }); }}
                  placeholder="Telefonnummer"
                  autoComplete="new-password"
                  name="customer-phone-field"
                  {...inp('flex-1')}
                />
                {phone && (
                  <button
                    type="button"
                    onClick={() => setCallOpen(true)}
                    title="Anrufen mit Notiz"
                    className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-600 hover:bg-emerald-500 transition-colors flex-shrink-0"
                  >
                    <Phone className="h-3.5 w-3.5 text-white" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* E-Mail */}
          <div className="flex items-center flex-1 gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>E-Mail</label>
              <div className="flex items-center gap-2">
                <Input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onBlur={() => { if (email !== (customer.email || "")) onUpdate({ email }); }}
                  placeholder="E-Mail-Adresse"
                  type="email"
                  autoComplete="new-password"
                  name="customer-email-field"
                  {...inp('flex-1')}
                />
                {email && (
                  <a
                    href={`mailto:${email}`}
                    title="E-Mail senden"
                    className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-600 hover:bg-emerald-500 transition-colors flex-shrink-0"
                  >
                    <Mail className="h-3.5 w-3.5 text-white" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Budget */}
          <div className="space-y-1 w-44 flex-shrink-0">
            <label className="text-[10px] font-medium tracking-wide" style={{ color: labelColor }}>Jahresbudget</label>
            <div
              className="flex items-center h-8 rounded-md overflow-hidden border"
              style={{ backgroundColor: inputBg, borderColor }}
            >
              <span className="text-xs flex-shrink-0 pl-2.5 pr-1 font-medium" style={{ color: labelColor }}>CHF</span>
              <input
                value={budget}
                onChange={e => setBudget(e.target.value)}
                onFocus={() => { if (budget) setBudget(budget.replace(/[^0-9.-]/g, "")); }}
                onBlur={handleBudgetBlur}
                placeholder="0.00"
                className="flex-1 bg-transparent text-emerald-600 text-sm font-semibold focus:outline-none min-w-0 pr-2.5 text-right"
                style={{ caretColor: textColor }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── MANDAT ────────────────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        <SectionLabel icon={Briefcase} label="Mandat" color={sectionColor} lineColor={lineColor} />
        <div className="grid grid-cols-2 gap-3">
          {[{ label: 'Mandatsleiter', field: 'mandatsleiter_id' }, { label: 'Sachbearbeiter', field: 'sachbearbeiter_id' }].map(({ label, field }) => (
            <div key={field} className="space-y-1">
              <label className="text-[10px] font-medium tracking-wide flex items-center gap-1" style={{ color: labelColor }}>
                <User className="h-2.5 w-2.5" /> {label}
              </label>
              <Select
                value={customer[field] || "none"}
                onValueChange={v => onUpdate({ [field]: v === "none" ? null : v })}
              >
                <SelectTrigger className="h-8 text-xs" style={inputStyle}>
                  <SelectValue placeholder="Wählen …" />
                </SelectTrigger>
                <SelectContent style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#ccd8cc' : '#e5e7eb' }}>
                  <SelectItem value="none" className="text-xs text-gray-400">Niemand</SelectItem>
                  {staff.map(u => (
                    <SelectItem key={u.id} value={u.id} className="text-xs text-gray-800">
                      {u.full_name || u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      <CallNotePopup
        open={callOpen}
        onClose={() => setCallOpen(false)}
        phone={phone}
        customerId={customer.id}
        customerName={customer.company_name}
      />
    </div>
  );
}
