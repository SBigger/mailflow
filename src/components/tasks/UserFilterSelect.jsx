import React from "react";
import { Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";

export default function UserFilterSelect({
  value, onChange, users = [],
  myLabel = 'Meine Tasks',
  allLabel = 'Alle Tasks',
  groupLabel = 'Nach Benutzer',
  showMe = true,
}) {
  const getDisplayLabel = () => {
    if (value === 'me') return myLabel;
    if (value === 'all') return allLabel;
    const user = users.find(u => u.email === value);
    return user ? (user.full_name || user.email) : value;
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-52 bg-zinc-900/60 border-zinc-700 text-zinc-200 h-9">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 shrink-0" />
          <span className="truncate">{getDisplayLabel()}</span>
        </div>
      </SelectTrigger>
      <SelectContent className="bg-zinc-900 border-zinc-800">
        <SelectGroup>
          <SelectLabel className="text-zinc-400 text-xs">Ansicht</SelectLabel>
          {showMe && (
            <SelectItem value="me" className="text-zinc-200">
              {myLabel}
            </SelectItem>
          )}
          <SelectItem value="all" className="text-zinc-200">
            {allLabel}
          </SelectItem>
        </SelectGroup>

        {users.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-zinc-400 text-xs">{groupLabel}</SelectLabel>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.email} className="text-zinc-200">
                {user.full_name || user.email}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}