import React, { useState } from "react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Tag, Folder, Calendar } from "lucide-react";

export default function EditMailDialog({ open, onClose, mail, onSave }) {
  const [tags, setTags] = useState(mail?.tags || []);
  const [project, setProject] = useState(mail?.project || "");
  const [reminderDate, setReminderDate] = useState(
    mail?.reminder_date ? new Date(mail.reminder_date).toISOString().slice(0, 16) : ""
  );
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: existingTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      if (!currentUser) return [];
      return entities.Tag.filter({ created_by: currentUser.id });
    },
    enabled: !!currentUser,
  });

  const { data: existingProjects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => entities.Project.list(),
  });

  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredProjects = existingProjects
    .filter(p => 
      p.name.toLowerCase().includes(project.toLowerCase())
    )
    .slice(0, 5);

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleAddTag = (tagName) => {
    if (!tags.includes(tagName)) {
      setTags([...tags, tagName]);
    }
  };

  const handleSave = () => {
    onSave({ 
      tags, 
      project: project.trim() || null,
      reminder_date: reminderDate ? new Date(reminderDate).toISOString() : null
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">E-Mail bearbeiten</DialogTitle>
          <p className="text-sm text-zinc-500 mt-1">{mail?.subject}</p>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Project */}
          <div className="space-y-2">
            <Label className="text-zinc-300 flex items-center gap-2">
              <Folder className="h-4 w-4" />
              Projekt
            </Label>
            <div className="relative">
              <Input
                value={project}
                onChange={(e) => { setProject(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="z.B. Website Redesign"
                className="bg-zinc-900 border-zinc-700 text-zinc-200"
              />
              
              {/* Project Suggestions */}
              {showSuggestions && project && filteredProjects.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredProjects.map((proj) => (
                    <button
                      key={proj.id}
                      onMouseDown={(e) => { e.preventDefault(); setProject(proj.name); setShowSuggestions(false); }}
                      className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2"
                    >
                      <Folder className="h-3 w-3 text-indigo-400" />
                      {proj.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Reminder */}
          <div className="space-y-2">
            <Label className="text-zinc-300 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Reminder
            </Label>
            <Input
              type="datetime-local"
              value={reminderDate}
              onChange={(e) => setReminderDate(e.target.value)}
              className="bg-zinc-900 border-zinc-700 text-zinc-200"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label className="text-zinc-300 flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Tags
            </Label>

            {/* Existing Tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="bg-violet-500/10 border-violet-500/30 text-violet-300 gap-2"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-violet-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Tag Selection */}
            <Select value="" onValueChange={handleAddTag}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-200">
                <SelectValue placeholder="Tag hinzufügen..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {existingTags
                  .filter(t => !tags.includes(t.name))
                  .map((tag) => (
                    <SelectItem key={tag.id} value={tag.name} className="text-zinc-200">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color || '#a78bfa' }} />
                        {tag.name}
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400">
            Abbrechen
          </Button>
          <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-500">
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}