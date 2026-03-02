import React, { useContext } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";

export default function ViewModeDropdown({ 
  viewMode, 
  onViewModeChange, 
  onAutoAnalyze,
  isAnalyzing 
}) {
  const { theme } = useContext(ThemeContext) || { theme: 'dark' };
  const isLightish = theme === 'light' || theme === 'artis';

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline"
            className={`gap-2 text-sm rounded-xl ${isLightish ? 'border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-900' : 'border-zinc-600/50 text-zinc-600 hover:bg-zinc-900/50 hover:text-zinc-100'}`}
          >
            {viewMode === 'columns' ? 'Nach Spalten' : 'Nach Tags'}
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={isLightish ? 'bg-white border-gray-200 text-gray-800' : 'bg-zinc-900 border-zinc-700 text-zinc-200'}>
          <DropdownMenuItem 
            onClick={() => onViewModeChange('columns')}
            className={viewMode === 'columns' ? 'bg-indigo-600/20 text-indigo-600' : ''}
          >
            Nach Spalten anzeigen
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => onViewModeChange('tags')}
            className={viewMode === 'tags' ? 'bg-indigo-600/20 text-indigo-600' : ''}
          >
            Nach Tags anzeigen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        onClick={onAutoAnalyze}
        disabled={isAnalyzing}
        className="bg-violet-600 hover:bg-violet-500 text-white gap-2 text-sm rounded-xl"
      >
        <Sparkles className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
        {isAnalyzing ? 'Analysiere...' : 'AI Analyse'}
      </Button>
    </div>
  );
}