import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Filter, Tag } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export default function MailFilters({ allMails, onFilterChange }) {
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);

  // Get unique tags and projects from all mails
  const allTags = [...new Set(allMails.flatMap(m => m.tags || []))].sort();
  const allProjects = [...new Set(allMails.map(m => m.project).filter(Boolean))].sort();

  const handleTagToggle = (tag) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag];
    setSelectedTags(newTags);
    onFilterChange({ tags: newTags, project: selectedProject });
  };

  const handleProjectToggle = (project) => {
    const newProject = selectedProject === project ? null : project;
    setSelectedProject(newProject);
    onFilterChange({ tags: selectedTags, project: newProject });
  };

  const clearFilters = () => {
    setSelectedTags([]);
    setSelectedProject(null);
    onFilterChange({ tags: [], project: null });
  };

  const hasActiveFilters = selectedTags.length > 0 || selectedProject;

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-2"
          >
            <Filter className="h-4 w-4" />
            Filter
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 bg-indigo-600 text-white">
                {selectedTags.length + (selectedProject ? 1 : 0)}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 bg-zinc-900 border-zinc-800 text-zinc-200">
          <div className="space-y-4">
            {/* Projects */}
            {allProjects.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Projekte
                </h4>
                <div className="flex flex-wrap gap-2">
                  {allProjects.map((project) => (
                    <Badge
                      key={project}
                      variant={selectedProject === project ? "default" : "outline"}
                      className={`cursor-pointer ${
                        selectedProject === project
                          ? "bg-indigo-600 text-white"
                          : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                      }`}
                      onClick={() => handleProjectToggle(project)}
                    >
                      {project}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {allTags.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Tags
                </h4>
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                  {allTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant={selectedTags.includes(tag) ? "default" : "outline"}
                      className={`cursor-pointer ${
                        selectedTags.includes(tag)
                          ? "bg-violet-600 text-white"
                          : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                      }`}
                      onClick={() => handleTagToggle(tag)}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="w-full text-zinc-400 hover:text-zinc-200"
              >
                <X className="h-4 w-4 mr-2" />
                Filter zurücksetzen
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2">
          {selectedProject && (
            <Badge
              variant="secondary"
              className="bg-indigo-600 text-white gap-1"
            >
              {selectedProject}
              <button onClick={() => handleProjectToggle(selectedProject)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {selectedTags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="bg-violet-600 text-white gap-1"
            >
              {tag}
              <button onClick={() => handleTagToggle(tag)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}