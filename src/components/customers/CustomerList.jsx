import React, { useState, useContext } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search, Building2, UserRound, ChevronDown, ChevronRight,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeContext } from "@/Layout";

function CustomerListItem({ customer, selectedId, onSelect, isArtis, isLight, textMuted }) {
  const isPrivat  = customer.person_type === 'privatperson';
  const isInaktiv = customer.aktiv === false;
  return (
    <button
      key={customer.id}
      onClick={() => onSelect(customer)}
      className={`w-full text-left px-3 py-3 rounded-lg transition-colors border-l-4 border-t border-r border-b ${isInaktiv ? 'opacity-50' : ''}`}
      style={selectedId === customer.id ? {
        backgroundColor: isArtis ? 'rgba(122,155,127,0.18)' : isLight ? 'rgba(124,58,237,0.1)' : 'rgba(124,58,237,0.18)',
        borderLeftColor:  isArtis ? '#7a9b7f' : '#7c3aed',
        borderTopColor:   isArtis ? 'rgba(122,155,127,0.3)' : 'rgba(124,58,237,0.25)',
        borderRightColor: isArtis ? 'rgba(122,155,127,0.3)' : 'rgba(124,58,237,0.25)',
        borderBottomColor:isArtis ? 'rgba(122,155,127,0.3)' : 'rgba(124,58,237,0.25)',
        color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7',
      } : {
        borderLeftColor:  'transparent',
        borderTopColor:   'transparent',
        borderRightColor: 'transparent',
        borderBottomColor:'transparent',
        color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7',
      }}
      onMouseEnter={e => { if (selectedId !== customer.id) { e.currentTarget.style.backgroundColor = isArtis ? '#edf2ed' : isLight ? '#ebebf4' : 'rgba(63,63,70,0.4)'; } }}
      onMouseLeave={e => { if (selectedId !== customer.id) { e.currentTarget.style.backgroundColor = 'transparent'; } }}
    >
      <div className="flex items-center gap-2 mb-1">
        {isPrivat
          ? <UserRound className="h-3.5 w-3.5 flex-shrink-0" style={{ color: isArtis ? '#7a9b7f' : '#7c3aed' }} />
          : <Building2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: textMuted }} />
        }
        <span className={`text-sm font-medium truncate ${isInaktiv ? 'line-through' : ''}`} style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}>
          {customer.company_name}
        </span>
        {isInaktiv && (
          <span className="ml-auto text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-500 border border-red-200 font-semibold flex-shrink-0">
            INAKTIV
          </span>
        )}
      </div>
      {customer.tags?.length > 0 && !isInaktiv && (
        <div className="flex flex-wrap gap-1 ml-5">
          {customer.tags.map(tag => (
            <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0" style={{ borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#3f3f46', color: textMuted }}>
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </button>
  );
}

export default function CustomerList({
  customers,
  selectedId,
  onSelect,
  onNew,
  onNewPrivatperson,
  personTypeFilter = "alle",
}) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const textMuted = isArtis ? '#8aaa8f' : isLight ? '#8080a0' : '#71717a';

  // Filter by type first — always hide Nebendomizile from main list
  const typeFiltered = customers.filter(c => {
    if (c.ist_nebensteuerdomizil === true) return false; // Nebendomizile nie in Hauptliste
    const matchType =
      personTypeFilter === "alle" ? true :
      personTypeFilter === "privatperson" ? c.person_type === "privatperson" :
      /* unternehmen */ (c.person_type === "unternehmen" || !c.person_type);
    return matchType;
  });

  // Split into active and inactive, both searchable
  const searchFiltered = typeFiltered.filter(c =>
    (c.company_name || "").toLowerCase().includes(search.toLowerCase())
  );
  const activeCustomers   = searchFiltered.filter(c => c.aktiv !== false);
  const inactiveCustomers = searchFiltered.filter(c => c.aktiv === false);

  return (
    <div className="flex flex-col h-full border-r" style={{ backgroundColor: isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(24,24,27,0.4)', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
      <div className="p-4 border-b" style={{ borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: textMuted }} />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen..."
            className="pl-9"
            style={{ backgroundColor: isArtis ? '#f5f5f5' : isLight ? '#f0f0f8' : 'rgba(24,24,27,0.6)', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#3f3f46', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {activeCustomers.map(customer => (
          <CustomerListItem key={customer.id} customer={customer} selectedId={selectedId} onSelect={onSelect} isArtis={isArtis} isLight={isLight} textMuted={textMuted} />
        ))}
        {activeCustomers.length === 0 && inactiveCustomers.length === 0 && (
          <div className="text-center py-8 text-sm" style={{ color: textMuted }}>
            {personTypeFilter === "privatperson" ? "Keine Privatpersonen" :
             personTypeFilter === "unternehmen"  ? "Keine Unternehmen" :
             "Keine Einträge gefunden"}
          </div>
        )}

        {/* ── Inaktive: ausklappbarer Bereich ── */}
        {inactiveCustomers.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowInactive(v => !v)}
              className="flex items-center gap-1.5 w-full px-3 py-2 rounded-md text-xs font-medium transition-colors hover:bg-gray-100"
              style={{ color: textMuted }}
            >
              {showInactive ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span>Inaktiv ({inactiveCustomers.length})</span>
            </button>
            {showInactive && (
              <div className="space-y-1 mt-1">
                {inactiveCustomers.map(customer => (
                  <CustomerListItem key={customer.id} customer={customer} selectedId={selectedId} onSelect={onSelect} isArtis={isArtis} isLight={isLight} textMuted={textMuted} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: split new button */}
      <div className="p-4 border-t" style={{ borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
        <div className="flex gap-1">
          <Button
            onClick={onNew}
            className="flex-1 bg-violet-600 hover:bg-violet-500 text-sm gap-1"
          >
            <Building2 className="h-4 w-4" />
            Unternehmen
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-violet-600 hover:bg-violet-500 px-2">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={onNew} className="gap-2">
                <Building2 className="h-4 w-4" /> Unternehmen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onNewPrivatperson} className="gap-2">
                <UserRound className="h-4 w-4" /> Privatperson
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
