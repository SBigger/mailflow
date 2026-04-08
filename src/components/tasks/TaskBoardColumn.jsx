import React, { useState, useEffect, useContext } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import { MoreVertical, Edit2, Trash2, Palette, ChevronDown, ChevronRight, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeContext } from "@/Layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import TaskCard from "./TaskCard";

import TaskListViewOverlay from "./TaskListViewOverlay";

export default function TaskBoardColumn({ column, index, tasks, onRename, onDelete, onChangeColor, onTaskClick, onToggleComplete, isCollapsed, onToggleCollapse, currentUser, priorities = [] }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const { data: allUsers = [] } = useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      try {
        const res = await functions.invoke('getAllUsers');
        return res.data?.users || [];
      } catch (e) {
        return [];
      }
    },
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(column.name);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showListView, setShowListView] = useState(false);
  
  // Load saved expanded state from localStorage (pro Benutzer + Spalte)
  const storageKey = `taskboard-expanded-${currentUser?.email}-${column.id}`;
  const allAssigneeEmails = [...new Set(tasks.map(t => t.assignee || 'Unzugewiesen'))];
  
  const [expandedAssignees, setExpandedAssignees] = useState(() => new Set(allAssigneeEmails));

  // Expand newly appearing assignees automatically
  useEffect(() => {
    setExpandedAssignees(prev => {
      const newSet = new Set(prev);
      allAssigneeEmails.forEach(e => newSet.add(e));
      return newSet;
    });
  }, [tasks.length]);

  const handleRename = () => {
    if (editName.trim()) {
      onRename(column.id, editName.trim());
      setIsEditing(false);
    }
  };

  const activeTasks = tasks.filter(t => !t.completed).sort((a, b) => (a.order || 0) - (b.order || 0));
  const completedTasks = tasks.filter(t => t.completed).sort((a, b) => (a.order || 0) - (b.order || 0));
  const completedCount = completedTasks.length;
  const totalCount = tasks.length;

  if (isCollapsed) {
    return (
      <Draggable draggableId={`column-${column.id}`} index={index}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            onClick={() => onToggleCollapse(column.id)}
            className="flex-shrink-0 w-16 h-full rounded-2xl p-3 cursor-pointer transition-all border"
            style={{ 
              backgroundColor: isLight ? '#ffffff' : 'rgba(24,24,27,0.5)',
              borderColor: isLight ? '#d4d4e8' : 'rgba(63,63,70,0.4)',
              borderTopColor: column.color || '#4F46E5',
              borderTopWidth: '3px'
            }}
          >
            <div className="flex flex-col items-center justify-between h-full">
              <ChevronRight className="h-4 w-4 text-zinc-500 flex-shrink-0" />
              <div className="text-sm font-medium flex-1 flex items-center justify-center" style={{ color: '#ffffff', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                {column.name}
              </div>
              <Badge variant="outline" className="text-xs flex-shrink-0">{activeTasks.length}</Badge>
            </div>
          </div>
        )}
      </Draggable>
    );
  }

  return (
    <>
    <Draggable draggableId={`column-${column.id}`} index={index}>
      {(provided) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className="flex-shrink-0 w-80 flex flex-col h-full"
        >
          <div 
           {...provided.dragHandleProps}
           className="flex items-center justify-between px-4 py-3 mb-3"
          >
            <div className="flex items-center gap-3">
              <button 
                onClick={() => onToggleCollapse(column.id)}
                className="transition-colors"
                style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a' }}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: column.color || '#4F46E5' }} />
              {isEditing ? (
                 <input
                   value={editName}
                   onChange={(e) => setEditName(e.target.value)}
                   onBlur={handleRename}
                   onKeyDown={(e) => e.key === "Enter" && handleRename()}
                   className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                   style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}
                   autoFocus
                 />
               ) : (
                 <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}>
                   {column.name}
                 </h3>
               )}
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a', backgroundColor: isArtis ? 'rgba(122,155,127,0.12)' : isLight ? 'rgba(100,100,180,0.12)' : 'rgba(39,39,42,0.6)' }}>
                {activeTasks.length}
              </span>
            </div>

            <div className="flex items-center gap-1">
               <Button
                 variant="ghost"
                 size="icon"
                 className="h-7 w-7 hover:bg-white/5"
                 style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a' }}
                 title="Listenansicht"
                 onClick={() => setShowListView(true)}
               >
                 <List className="h-4 w-4" />
               </Button>
               <DropdownMenu>
                 <DropdownMenuTrigger asChild>
                   <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-white/5" style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a' }}>
                     <MoreVertical className="h-4 w-4" />
                   </Button>
                 </DropdownMenuTrigger>
                 <DropdownMenuContent style={{ backgroundColor: isLight ? '#ffffff' : '#18181b', borderColor: isLight ? '#d4d4e8' : '#3f3f46', color: isLight ? '#1a1a2e' : '#e4e4e7' }}>
                  <DropdownMenuItem onClick={() => setIsEditing(true)} className="hover:bg-white/5">
                      <Edit2 className="h-4 w-4 mr-2" /> Umbenennen
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onChangeColor(column)} className="hover:bg-white/5">
                      <Palette className="h-4 w-4 mr-2" /> Farbe ändern
                    </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDelete(column.id)} className="text-red-400 focus:bg-red-500/10 focus:text-red-300">
                    <Trash2 className="h-4 w-4 mr-2" /> Löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Droppable droppableId={column.id}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`
                  flex-1 overflow-y-auto px-1 transition-all duration-200
                  ${snapshot.isDraggingOver ? "bg-indigo-500/5" : ""}
                `}
              >
                {activeTasks.map((task, idx) => {
                  const assigneeUser = allUsers.find(u => u.email === task.assignee);
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      index={idx}
                      onClick={onTaskClick}
                      onToggleComplete={onToggleComplete}
                      currentUser={currentUser}
                      priorities={priorities}
                      assigneeUser={assigneeUser}
                    />
                  );
                })}

                {/* Completed section - not draggable */}
                {completedTasks.length > 0 && (
                  <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${isLight ? '#d4d4e8' : 'rgba(63,63,70,0.5)'}` }}>
                    <button
                      onClick={() => setShowCompleted(!showCompleted)}
                      className="flex items-center justify-between w-full text-xs mb-2 px-2 transition-colors"
                      style={{ color: isLight ? '#8080a0' : '#52525b' }}
                    >
                      <span>Erledigt ({completedTasks.length})</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${showCompleted ? '' : '-rotate-90'}`} />
                      </button>
                      {showCompleted && completedTasks.length > 0 && completedTasks.map((task, idx) => {
                      const assigneeUser = allUsers.find(u => u.email === task.assignee);
                      return (
                        <TaskCard
                          key={task.id}
                          task={task}
                          index={activeTasks.length + idx}
                          onClick={onTaskClick}
                          onToggleComplete={onToggleComplete}
                          currentUser={currentUser}
                          priorities={priorities}
                          assigneeUser={assigneeUser}
                        />
                      );
                    })}
                  </div>
                )}
                
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </div>
      )}
    </Draggable>

    {showListView && (
      <TaskListViewOverlay
        column={column}
        tasks={tasks}
        onClose={() => setShowListView(false)}
        onTaskClick={(task) => { onTaskClick(task); setShowListView(false); }}
        onToggleComplete={onToggleComplete}
      />
    )}
    </>
    );
    }