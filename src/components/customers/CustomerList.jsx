import React, { useState, useContext } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Building2 } from "lucide-react";
import { ThemeContext } from "@/Layout";

export default function CustomerList({ customers, selectedId, onSelect, onNew }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [search, setSearch] = useState("");

  const filtered = customers.filter(c =>
    c.company_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full border-r" style={{ backgroundColor: isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(24,24,27,0.4)', borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
      <div className="p-4 border-b" style={{ borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
         <div className="relative">
           <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: isArtis ? '#8aaa8f' : isLight ? '#8080a0' : '#71717a' }} />
           <Input
             value={search}
             onChange={e => setSearch(e.target.value)}
             placeholder="Kunde suchen..."
             className="pl-9"
             style={{ backgroundColor: isArtis ? '#f5f5f5' : isLight ? '#f0f0f8' : 'rgba(24,24,27,0.6)', borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#3f3f46', color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}
           />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.map(customer => (
          <button
            key={customer.id}
            onClick={() => onSelect(customer)}
            className={`w-full text-left px-3 py-3 rounded-lg transition-colors border ${
              selectedId === customer.id
                ? "bg-violet-600/20 border-violet-500/30"
                : "border-transparent"
            }`}
            style={selectedId !== customer.id ? { color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' } : {}}
            onMouseEnter={e => { if (selectedId !== customer.id) e.currentTarget.style.backgroundColor = isArtis ? '#edf2ed' : isLight ? '#ebebf4' : 'rgba(63,63,70,0.4)'; }}
            onMouseLeave={e => { if (selectedId !== customer.id) e.currentTarget.style.backgroundColor = ''; }}
          >
            <div className="flex items-center gap-2 mb-1">
               <Building2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: isArtis ? '#8aaa8f' : isLight ? '#8080a0' : '#71717a' }} />
               <span className="text-sm font-medium truncate" style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}>{customer.company_name}</span>
             </div>
            {customer.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 ml-5">
                {customer.tags.map(tag => (
                  <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0" style={{ borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#3f3f46', color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a' }}>
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
           <div className="text-center py-8 text-sm" style={{ color: isArtis ? '#8aaa8f' : isLight ? '#9090b8' : '#52525b' }}>Keine Kunden gefunden</div>
         )}
      </div>

      <div className="p-4 border-t" style={{ borderColor: isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)' }}>
         <Button onClick={onNew} className="w-full bg-violet-600 hover:bg-violet-500 text-sm">
           <Plus className="h-4 w-4" />
           Neuer Kunde
         </Button>
       </div>
    </div>
  );
}