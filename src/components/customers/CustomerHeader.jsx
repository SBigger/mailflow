import React, { useState, useEffect, useContext } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Phone } from "lucide-react";
import { ThemeContext } from "@/Layout";

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

export default function CustomerHeader({ customer, staff, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';

  const isPrivatperson   = customer.person_type === 'privatperson';
  const isInaktiv        = customer.aktiv === false;
  // Shared fields
  const [strasse,  setStrasse]  = useState(customer.strasse || "");
  const [plz,      setPlz]      = useState(customer.plz || "");
  const [ort,      setOrt]      = useState(customer.ort || "");
  const [phone,    setPhone]    = useState(customer.phone || "");
  const [budget,   setBudget]   = useState(customer.budget !== undefined && customer.budget !== null ? formatBudgetStatic(customer.budget) : "");

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

  const inputClass = isArtis
    ? 'bg-white border-[#bfcfbf] text-[#2d3a2d] placeholder:text-[#8aaa8f]'
    : isLight
    ? 'bg-white border-[#c8c8dc] text-[#1a1a2e] placeholder:text-[#9090b8]'
    : 'bg-white border-gray-300 text-gray-800 placeholder:text-gray-400';

  const labelColor = isArtis ? '#6b826b' : isLight ? '#8080a0' : '#71717a';

  return (
    <div className="p-6 space-y-4 border-b" style={{ borderColor: isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>

      {/* ── Title row: Name + Inaktiv toggle oben rechts ── */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {isPrivatperson ? (
            <div className="flex flex-col gap-2">
              <select
                value={anrede}
                onChange={e => handleAnredeChange(e.target.value)}
                className={`rounded-md border px-3 py-1.5 text-sm w-32 ${inputClass}`}
                style={{ height: 36 }}
              >
                <option value="">Anrede</option>
                <option value="Herr">Herr</option>
                <option value="Frau">Frau</option>
              </select>
              <div className="flex gap-2">
                <Input
                  value={nachname}
                  onChange={e => setNachname(e.target.value)}
                  onBlur={handleNameBlur}
                  className={`text-2xl font-bold focus-visible:ring-violet-500 h-auto py-2 flex-1 ${inputClass}`}
                  placeholder="Nachname..."
                />
                <Input
                  value={vorname}
                  onChange={e => setVorname(e.target.value)}
                  onBlur={handleNameBlur}
                  className={`text-2xl font-bold focus-visible:ring-violet-500 h-auto py-2 flex-1 ${inputClass}`}
                  placeholder="Vorname..."
                />
              </div>
            </div>
          ) : (
            <Input
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              onBlur={() => { if (companyName !== customer.company_name) onUpdate({ company_name: companyName }); }}
              className={`text-2xl font-bold focus-visible:ring-violet-500 h-auto py-2 ${inputClass}`}
              placeholder="Firmenname..."
            />
          )}
        </div>

        {/* Inaktiv-Toggle oben rechts */}
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

      {/* ── Privatperson extra fields: AHV + Geburtsdatum ── */}
      {isPrivatperson && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs" style={{ color: labelColor }}>AHV-Nummer</label>
            <Input
              value={ahvNummer}
              onChange={e => setAhvNummer(e.target.value)}
              onBlur={() => { if (ahvNummer !== (customer.ahv_nummer || "")) onUpdate({ ahv_nummer: ahvNummer }); }}
              placeholder="756.XXXX.XXXX.XX"
              className={`text-sm h-8 ${inputClass}`}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs" style={{ color: labelColor }}>Geburtsdatum</label>
            <Input
              type="date"
              value={geburtsdatum}
              onChange={e => setGeburtsdatum(e.target.value)}
              onBlur={() => { if (geburtsdatum !== (customer.geburtsdatum || "")) onUpdate({ geburtsdatum: geburtsdatum || null }); }}
              className={`text-sm h-8 ${inputClass}`}
            />
          </div>
        </div>
      )}

      {/* ── Partner (nur Privatperson) ── */}
      {isPrivatperson && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs" style={{ color: labelColor }}>Partner Nachname</label>
            <Input
              value={partnerName}
              onChange={e => setPartnerName(e.target.value)}
              onBlur={() => { if (partnerName !== (customer.partner_name || "")) onUpdate({ partner_name: partnerName || null }); }}
              placeholder="Partner Nachname"
              className={`text-sm h-8 ${inputClass}`}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs" style={{ color: labelColor }}>Partner Vorname</label>
            <Input
              value={partnerVorname}
              onChange={e => setPartnerVorname(e.target.value)}
              onBlur={() => { if (partnerVorname !== (customer.partner_vorname || "")) onUpdate({ partner_vorname: partnerVorname || null }); }}
              placeholder="Partner Vorname"
              className={`text-sm h-8 ${inputClass}`}
            />
          </div>
        </div>
      )}

      {/* ── Adresse ── */}
      <div className="space-y-2">
        <Input value={strasse} onChange={e => setStrasse(e.target.value)} onBlur={() => { if (strasse !== customer.strasse) onUpdate({ strasse }); }} placeholder="Strasse" autoComplete="off" className={`text-sm h-8 ${inputClass}`} />
        <div className="flex gap-2">
          <Input value={plz} onChange={e => setPlz(e.target.value)} onBlur={() => { if (plz !== customer.plz) onUpdate({ plz }); }} placeholder="PLZ" autoComplete="off" className={`text-sm h-8 w-20 ${inputClass}`} />
          <Input value={ort} onChange={e => setOrt(e.target.value)} onBlur={() => { if (ort !== customer.ort) onUpdate({ ort }); }} placeholder="Ort" autoComplete="off" className={`text-sm h-8 flex-1 ${inputClass}`} />
          <Select
            value={kanton || "__none__"}
            onValueChange={v => {
              const val = v === "__none__" ? "" : v;
              setKanton(val);
              onUpdate({ kanton: val || null });
            }}
          >
            <SelectTrigger className={`h-8 text-xs w-52 flex-shrink-0 ${inputClass}`}>
              <SelectValue placeholder="KT" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-gray-400">— KT</SelectItem>
              {CH_KANTONE.map(k => (
                <SelectItem key={k.code} value={k.code} className="text-xs text-gray-800">
                  {k.code} – {k.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Telefon & Budget ── */}
      <div className="flex gap-2">
        <div className="flex items-center flex-1 gap-2">
          <Input value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => { if (phone !== (customer.phone || "")) onUpdate({ phone }); }} placeholder="Telefon" autoComplete="new-password" name="customer-phone-field" className={`text-sm h-8 flex-1 ${inputClass}`} />
          {phone && (
            <a href={`tel:${phone}`} title="Anrufen" className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-600 hover:bg-emerald-500 transition-colors flex-shrink-0">
              <Phone className="h-3.5 w-3.5 text-white" />
            </a>
          )}
        </div>
        <div className="flex items-center w-52 flex-shrink-0 rounded-md h-8 overflow-hidden border" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db' }}>
          <span className="text-xs flex-shrink-0 pl-2 pr-1" style={{ color: isLight ? '#8080a0' : '#71717a' }}>CHF</span>
          <input value={budget} onChange={e => setBudget(e.target.value)} onFocus={() => { if (budget) setBudget(budget.replace(/[^0-9.-]/g, "")); }} onBlur={handleBudgetBlur} placeholder="0.00" className="flex-1 bg-transparent text-emerald-500 text-sm font-medium focus:outline-none min-w-0 pr-2 text-right" style={{ caretColor: isLight ? '#1a1a2e' : 'white' }} />
        </div>
      </div>

      {/* ── Mandatsleiter & Sachbearbeiter ── */}
      <div className="grid grid-cols-2 gap-4">
        {[{ label: 'Mandatsleiter', field: 'mandatsleiter_id' }, { label: 'Sachbearbeiter', field: 'sachbearbeiter_id' }].map(({ label, field }) => (
          <div key={field} className="space-y-1">
            <label className="text-xs flex items-center gap-1" style={{ color: labelColor }}>
              <User className="h-3 w-3" /> {label}
            </label>
            <Select value={customer[field] || "none"} onValueChange={v => onUpdate({ [field]: v === "none" ? null : v })}>
              <SelectTrigger className="h-8 text-xs" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }}>
                <SelectValue placeholder="Wählen..." />
              </SelectTrigger>
              <SelectContent style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#ccd8cc' : '#e5e7eb' }}>
                <SelectItem value="none" className="text-xs text-gray-400">Niemand</SelectItem>
                {staff.map(u => (
                  <SelectItem key={u.id} value={u.id} className="text-xs text-gray-800">{u.full_name || u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
