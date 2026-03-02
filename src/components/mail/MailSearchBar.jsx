import React, { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { de } from "date-fns/locale";

export default function MailSearchBar({ value, onChange, onAdvancedSearch }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [searchField, setSearchField] = useState('all'); // all, subject, sender, recipient

  const handleApplyAdvanced = () => {
    onAdvancedSearch?.({
      dateFrom,
      dateTo,
      searchField
    });
    setShowAdvanced(false);
  };

  const handleClearAdvanced = () => {
    setDateFrom(null);
    setDateTo(null);
    setSearchField('all');
    onAdvancedSearch?.({
      dateFrom: null,
      dateTo: null,
      searchField: 'all'
    });
  };

  const hasAdvancedFilters = dateFrom || dateTo || searchField !== 'all';

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 min-w-[300px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <Input
          placeholder="E-Mail suchen (Name, Adresse, Betreff...)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9 pr-9 bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
        />
        {value && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Popover open={showAdvanced} onOpenChange={setShowAdvanced}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={`border-zinc-700 hover:bg-zinc-800 ${
              hasAdvancedFilters ? 'bg-indigo-600/20 border-indigo-600/50 text-indigo-300' : 'text-zinc-400'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 bg-zinc-900 border-zinc-800" align="end">
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-zinc-100 mb-3">Erweiterte Suche</h4>
            </div>

            {/* Search Field Selector */}
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Suchen in:</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={searchField === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSearchField('all')}
                  className={searchField === 'all' ? 'bg-indigo-600 text-white' : 'border-zinc-700 text-zinc-900 bg-white hover:bg-zinc-100'}
                >
                  Alle Felder
                </Button>
                <Button
                  variant={searchField === 'subject' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSearchField('subject')}
                  className={searchField === 'subject' ? 'bg-indigo-600 text-white' : 'border-zinc-700 text-zinc-900 bg-white hover:bg-zinc-100'}
                >
                  Betreff
                </Button>
                <Button
                  variant={searchField === 'sender' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSearchField('sender')}
                  className={searchField === 'sender' ? 'bg-indigo-600 text-white' : 'border-zinc-700 text-zinc-900 bg-white hover:bg-zinc-100'}
                >
                  Absender
                </Button>
                <Button
                  variant={searchField === 'recipient' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSearchField('recipient')}
                  className={searchField === 'recipient' ? 'bg-indigo-600 text-white' : 'border-zinc-700 text-zinc-900 bg-white hover:bg-zinc-100'}
                >
                  Empfänger
                </Button>
              </div>
            </div>

            {/* Date From */}
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Datum von:</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal border-zinc-700 text-zinc-900 bg-white hover:bg-zinc-100"
                  >
                    {dateFrom ? format(dateFrom, "dd. MMMM yyyy", { locale: de }) : "Kein Datum"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-zinc-900 border-zinc-800" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                    locale={de}
                    className="text-zinc-100"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Date To */}
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Datum bis:</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal border-zinc-700 text-zinc-900 bg-white hover:bg-zinc-100"
                  >
                    {dateTo ? format(dateTo, "dd. MMMM yyyy", { locale: de }) : "Kein Datum"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-zinc-900 border-zinc-800" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                    locale={de}
                    className="text-zinc-100"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAdvanced}
                className="flex-1 border-zinc-700 text-zinc-900 bg-white hover:bg-zinc-100"
              >
                Zurücksetzen
              </Button>
              <Button
                size="sm"
                onClick={handleApplyAdvanced}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Anwenden
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}