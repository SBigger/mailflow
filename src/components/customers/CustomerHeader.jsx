import React, { useState, useEffect, useContext } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Phone } from "lucide-react";
import { ThemeContext } from "@/Layout";

export default function CustomerHeader({ customer, staff, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [companyName, setCompanyName] = useState(customer.company_name || "");
  const [strasse, setStrasse] = useState(customer.strasse || "");
  const [plz, setPlz] = useState(customer.plz || "");
  const [ort, setOrt] = useState(customer.ort || "");
  const [phone, setPhone] = useState(customer.phone || "");
  const [budget, setBudget] = useState(customer.budget !== undefined && customer.budget !== null ? formatBudgetStatic(customer.budget) : "");

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
  }, [customer.id]);

  const handleBudgetBlur = () => {
    const num = parseFloat(budget.replace(/[^0-9.-]/g, ""));
    const val = isNaN(num) ? null : num;
    if (val !== customer.budget) onUpdate({ budget: val });
    setBudget(isNaN(num) ? "" : num.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  };

  const inputClass = isArtis ? 'bg-white border-[#bfcfbf] text-[#2d3a2d] placeholder:text-[#8aaa8f]' : isLight ? 'bg-white border-[#c8c8dc] text-[#1a1a2e] placeholder:text-[#9090b8]' : 'bg-white border-gray-300 text-gray-800 placeholder:text-gray-400';

  return (
    <div className="p-6 space-y-4 border-b" style={{ borderColor: isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
      <Input
        value={companyName}
        onChange={e => setCompanyName(e.target.value)}
        onBlur={() => { if (companyName !== customer.company_name) onUpdate({ company_name: companyName }); }}
        className={`text-2xl font-bold focus-visible:ring-violet-500 h-auto py-2 ${inputClass}`}
        placeholder="Firmenname..."
      />

      {/* Adresse */}
      <div className="space-y-2">
        <Input value={strasse} onChange={e => setStrasse(e.target.value)} onBlur={() => { if (strasse !== customer.strasse) onUpdate({ strasse }); }} placeholder="Strasse" className={`text-sm h-8 ${inputClass}`} />
        <div className="flex gap-2">
          <Input value={plz} onChange={e => setPlz(e.target.value)} onBlur={() => { if (plz !== customer.plz) onUpdate({ plz }); }} placeholder="PLZ" className={`text-sm h-8 w-24 ${inputClass}`} />
          <Input value={ort} onChange={e => setOrt(e.target.value)} onBlur={() => { if (ort !== customer.ort) onUpdate({ ort }); }} placeholder="Ort" className={`text-sm h-8 flex-1 ${inputClass}`} />
        </div>
      </div>

      {/* Telefon & Budget */}
      <div className="flex gap-2">
        <div className="flex items-center flex-1 gap-2">
          <Input value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => { if (phone !== (customer.phone || "")) onUpdate({ phone }); }} placeholder="Telefon" autoComplete="new-password" name="customer-phone-field" className={`text-sm h-8 flex-1 ${inputClass}`} />
          {phone && (
            <a href={`tel:${phone}`} title="Anrufen" className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-600 hover:bg-emerald-500 transition-colors flex-shrink-0">
              <Phone className="h-3.5 w-3.5 text-white" />
            </a>
          )}
        </div>
        <div className="flex items-center w-40 rounded-md h-8 overflow-hidden border" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db' }}>
          <span className="text-xs flex-shrink-0 pl-2 pr-1" style={{ color: isLight ? '#8080a0' : '#71717a' }}>CHF</span>
          <input value={budget} onChange={e => setBudget(e.target.value)} onFocus={() => { if (budget) setBudget(budget.replace(/[^0-9.-]/g, "")); }} onBlur={handleBudgetBlur} placeholder="0.00" className="flex-1 bg-transparent text-emerald-500 text-sm font-medium focus:outline-none min-w-0 pr-2 text-right" style={{ caretColor: isLight ? '#1a1a2e' : 'white' }} />
        </div>
      </div>

      {/* Mandatsleiter & Sachbearbeiter */}
      <div className="grid grid-cols-2 gap-4">
        {[{ label: 'Mandatsleiter', field: 'mandatsleiter_id' }, { label: 'Sachbearbeiter', field: 'sachbearbeiter_id' }].map(({ label, field }) => (
          <div key={field} className="space-y-1">
            <label className="text-xs flex items-center gap-1" style={{ color: isLight ? '#8080a0' : '#71717a' }}>
              <User className="h-3 w-3" /> {label}
            </label>
            <Select value={customer[field] || "none"} onValueChange={v => onUpdate({ [field]: v === "none" ? null : v })}>
              <SelectTrigger className="h-8 text-xs" style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#1f2937' }}>
                <SelectValue placeholder="Wählen..." />
              </SelectTrigger>
              <SelectContent style={{ backgroundColor: '#ffffff', borderColor: isArtis ? '#ccd8cc' : '#e5e7eb' }}>
                <SelectItem value="none" className="text-xs text-gray-400">Niemand</SelectItem>
                {staff.map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs text-gray-800">{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}