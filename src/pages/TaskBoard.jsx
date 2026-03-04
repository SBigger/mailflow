import React, { useState, useMemo, useContext } from "react";
import { entities, functions, auth } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Plus, RefreshCw, Palette, Users, Search, X, ChevronsLeftRight, Mic, LayoutList, LayoutDashboard, MoreHorizontal } from "lucide-react";
import { useIsMobile } from "@/components/mobile/useIsMobile";
import MobileColumnNav from "@/components/mobile/MobileColumnNav";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";

import TaskBoardColumn from "../components/tasks/TaskBoardColumn";
import AddTaskDialog from "../components/tasks/AddTaskDialog";
import TaskDetailPanel from "../components/tasks/TaskDetailPanel";
import AddColumnDialog from "../components/mail/AddColumnDialog";
import EditColumnColorDialog from "../components/mail/EditColumnColorDialog";
import UserFilterSelect from "../components/tasks/UserFilterSelect";
import VoiceTaskDialog from "../components/tasks/VoiceTaskDialog";
import TaskGlobalListView from "../components/tasks/TaskGlobalListView";
import TaskCard from "../components/tasks/TaskCard";

export default function TaskBoard() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [showAddTask, setShowAddTask] = useState(false);
  const [showVoiceTask, setShowVoiceTask] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [collapsedColumns, setCollapsedColumns] = useState(new Set());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [editingColumnColor, setEditingColumnColor] = useState(null);
  const [sortByPriority, setSortByPriority] = useState(false);
   const [filterPriorityIds, setFilterPriorityIds] = useState([]);
   const [userFilter, setUserFilter] = useState('me');
   const [searchQuery, setSearchQuery] = useState("");
  const [globalListView, setGlobalListView] = useState(false);
  const [mobileColumnIndex, setMobileColumnIndex] = useState(0);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const isMobile = useIsMobile();

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => auth.me(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["allUsers", currentUser?.email],
    queryFn: async () => {
      try {
        const res = await functions.invoke('getAllUsers');
        const users = res.data?.users || [];
        return users.filter(u => u.role !== 'task_user' && u.email !== currentUser?.email);
      } catch (e) {
        console.error('Failed to load users:', e);
        return [];
      }
    },
    enabled: !!currentUser,
  });

  const { data: columns = [], isLoading: colLoading } = useQuery({
    queryKey: ["taskColumns"],
    queryFn: async () => {
      const allColumns = await entities.TaskColumn.list("order");
      return allColumns;
    },
  });

  const { data: tasks = [], isLoading: taskLoading } = useQuery({
    queryKey: ["tasks", currentUser?.email],
    queryFn: async () => {
      if (!currentUser) return [];
      // Security rules applied by backend: user sees only their created or assigned tasks
      const allTasks = await entities.Task.list("order");
      return allTasks;
    },
    enabled: !!currentUser,
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => entities.Priority.list("level"),
  });

  const filteredAndSortedTasks = useMemo(() => {
    let result = tasks;

    // Task-User sehen nur ihre eigenen Tasks
    if (currentUser?.role === 'task_user') {
      result = result.filter(t =>
        t.created_by === currentUser.id || t.assignee === currentUser.email
      );
    } else if (userFilter === 'me') {
      // Nur eigene Tasks: zugewiesen an mich, oder von mir erstellt ohne Zuweisung
      result = result.filter(t =>
        t.assignee === currentUser?.email ||
        (!t.assignee && t.created_by === currentUser?.id)
      );
    } else if (userFilter !== 'all') {
      // Filter nach spezifischem User (Email)
      result = result.filter(t =>
        t.assignee === userFilter ||
        (!t.assignee && t.created_by === userFilter)
      );
    }
    // Wenn userFilter === 'all', keine weitere Filterung - alle Tasks anzeigen

    // Filter by priority
    if (filterPriorityIds.length > 0) {
      result = result.filter(t => filterPriorityIds.includes(t.priority_id));
    }

    // Sort by priority
    if (sortByPriority) {
      result = [...result].sort((a, b) => {
        const priorityA = priorities.find(p => p.id === a.priority_id);
        const priorityB = priorities.find(p => p.id === b.priority_id);
        
        if (!priorityA && !priorityB) return 0;
        if (!priorityA) return 1;
        if (!priorityB) return -1;
        
        return priorityA.level - priorityB.level;
      });
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [tasks, filterPriorityIds, sortByPriority, priorities, currentUser, userFilter, searchQuery]);

  const createTaskMutation = useMutation({
    mutationFn: (data) => entities.Task.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task erstellt");
      setShowAddTask(false);
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id) => entities.Task.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task gelöscht");
      setSelectedTask(null);
    },
  });

  const createColumnMutation = useMutation({
    mutationFn: (data) => entities.TaskColumn.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taskColumns"] });
      toast.success("Spalte erstellt");
      setShowAddColumn(false);
    },
  });

  const updateColumnMutation = useMutation({
    mutationFn: ({ id, data }) => entities.TaskColumn.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["taskColumns"] }),
  });

  const deleteColumnMutation = useMutation({
    mutationFn: (id) => entities.TaskColumn.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taskColumns"] });
      toast.success("Spalte gelöscht");
    },
  });

  const handleDragEnd = (result) => {
    const { draggableId, destination, source, type } = result;
    if (!destination) return;

    if (type === 'column') {
      const reorderedColumns = Array.from(columns);
      const [moved] = reorderedColumns.splice(source.index, 1);
      reorderedColumns.splice(destination.index, 0, moved);

      reorderedColumns.forEach((col, idx) => {
        if (col.order !== idx) {
          updateColumnMutation.mutate({ id: col.id, data: { order: idx } });
        }
      });
      return;
    }

    // Task moved within or to different column
    const movedTask = filteredAndSortedTasks.find(t => t.id === draggableId);
    if (!movedTask) return;

    const destTasks = filteredAndSortedTasks
      .filter(t => t.column_id === destination.droppableId && t.id !== draggableId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    destTasks.splice(destination.index, 0, movedTask);

    destTasks.forEach((task, idx) => {
      updateTaskMutation.mutate({
        id: task.id,
        data: {
          column_id: destination.droppableId,
          order: idx
        }
      });
    });
  };

  const handleAddColumn = ({ name, color }) => {
    const maxOrder = columns.reduce((max, c) => Math.max(max, c.order || 0), 0);
    createColumnMutation.mutate({
      name,
      color,
      order: maxOrder + 1,
    });
  };



  const togglePriorityFilter = (priorityId) => {
    setFilterPriorityIds(prev => 
      prev.includes(priorityId) 
        ? prev.filter(id => id !== priorityId)
        : [...prev, priorityId]
    );
  };

  const topBarBg = isArtis ? '#f2f5f2' : isLight ? '#f0f0f6' : '#f2f5f2';
  const borderColor = isArtis ? '#ccd8cc' : isLight ? '#d4d4e8' : 'rgba(113,113,122,0.6)';
  const inputBg = isArtis ? '#ffffff' : isLight ? '#ffffff' : 'rgba(24,24,27,0.6)';
  const inputBorder = isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#3f3f46';
  const inputText = isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7';
  const mutedText = isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a';

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: topBarBg }}>
      {/* Top Bar */}
      <div className="flex-shrink-0 border-b px-3 md:px-6 py-3" style={{ backgroundColor: topBarBg, borderColor }}>
        {/* Mobile Top Bar */}
        {isMobile ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button onClick={() => setShowAddTask(true)} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white touch-manipulation">
                  <Plus className="h-4 w-4 mr-1" /> Task
                </Button>
                <Button onClick={() => setShowVoiceTask(true)} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white gap-1.5 touch-manipulation">
                   <Mic className="h-4 w-4" />
                 </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => setGlobalListView(v => !v)} className="h-9 w-9 touch-manipulation"
                  style={{ color: globalListView ? '#7c3aed' : mutedText }}>
                  {globalListView ? <LayoutDashboard className="h-4 w-4" /> : <LayoutList className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setShowMobileFilters(v => !v)} className="h-9 w-9 touch-manipulation"
                  style={{ color: showMobileFilters ? '#7c3aed' : mutedText }}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Mobile expandable filters */}
            {showMobileFilters && (
              <div className="flex flex-col gap-2 pb-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: mutedText }} />
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Tasks suchen..."
                    style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputText }}
                    className="pl-9 pr-8 py-2 text-sm border rounded-lg w-full h-9 focus:outline-none" />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: mutedText }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <UserFilterSelect value={userFilter} onChange={setUserFilter} users={allUsers} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2 h-9 flex-1"
                        style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputText }}>
                        <Palette className="h-4 w-4" />
                        Prioritäten
                        {filterPriorityIds.length > 0 && (
                          <span className="bg-indigo-500 text-white text-xs px-1.5 py-0.5 rounded-full">{filterPriorityIds.length}</span>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuCheckboxItem checked={sortByPriority} onCheckedChange={setSortByPriority}>
                        Nach Priorität sortieren
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      {priorities.map((priority) => (
                        <DropdownMenuCheckboxItem key={priority.id} checked={filterPriorityIds.includes(priority.id)} onCheckedChange={() => togglePriorityFilter(priority.id)}>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: priority.color }} />
                            {priority.name}
                          </div>
                        </DropdownMenuCheckboxItem>
                      ))}
                      {filterPriorityIds.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setFilterPriorityIds([])} className="text-red-500">Filter zurücksetzen</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button onClick={() => setShowVoiceTask(true)} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white gap-1.5 h-9 touch-manipulation flex-1">
                    <Mic className="h-4 w-4" /> Sprache
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries()} className="h-9 w-9 touch-manipulation" style={{ color: mutedText }}>
                    <RefreshCw className={`h-4 w-4 ${(colLoading || taskLoading) ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Desktop Top Bar */
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UserFilterSelect value={userFilter} onChange={setUserFilter} users={allUsers} />
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: mutedText }} />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Tasks suchen..."
                  style={{ backgroundColor: inputBg, borderColor: inputBorder, color: inputText }}
                  className="pl-9 pr-8 py-2 text-sm border rounded-lg placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-44 h-9" />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: mutedText }}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" title={globalListView ? "Kanban-Ansicht" : "Listenansicht"} onClick={() => setGlobalListView(v => !v)}
                className={`h-9 w-9 ${globalListView ? "text-violet-400 bg-violet-500/10" : ""}`} style={!globalListView ? { color: mutedText } : {}}>
                {globalListView ? <LayoutDashboard className="h-4 w-4" /> : <LayoutList className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" title={allCollapsed ? "Alle aufklappen" : "Alle einklappen"}
                onClick={() => { if (allCollapsed) { setCollapsedColumns(new Set()); } else { setCollapsedColumns(new Set(columns.map(c => c.id))); } setAllCollapsed(!allCollapsed); }}
                className="h-9 w-9" style={{ color: mutedText }}>
                <ChevronsLeftRight className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 h-9"
                    style={{ backgroundColor: inputBg, borderColor: inputBorder, color: isLight ? '#3a3a5a' : '#d4d4d8' }}>
                    <Palette className="h-4 w-4" />
                    Prioritäten
                    {filterPriorityIds.length > 0 && (
                      <span className="bg-indigo-500 text-white text-xs px-1.5 py-0.5 rounded-full">{filterPriorityIds.length}</span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-white border-gray-200 w-56">
                 <DropdownMenuCheckboxItem checked={sortByPriority} onCheckedChange={setSortByPriority} className="text-gray-700">
                   Nach Priorität sortieren
                 </DropdownMenuCheckboxItem>
                 <DropdownMenuSeparator className="bg-gray-200" />
                 {priorities.map((priority) => (
                   <DropdownMenuCheckboxItem key={priority.id} checked={filterPriorityIds.includes(priority.id)} onCheckedChange={() => togglePriorityFilter(priority.id)} className="text-gray-700">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: priority.color }} />
                        {priority.name}
                      </div>
                    </DropdownMenuCheckboxItem>
                  ))}
                  {filterPriorityIds.length > 0 && (
                    <>
                      <DropdownMenuSeparator className="bg-gray-200" />
                      <DropdownMenuItem onClick={() => setFilterPriorityIds([])} className="text-red-400">Filter zurücksetzen</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries()} className="h-9 w-9" style={{ color: mutedText }}>
                <RefreshCw className={`h-4 w-4 ${(colLoading || taskLoading) ? "animate-spin" : ""}`} />
              </Button>
              <Button onClick={() => setShowVoiceTask(true)} size="sm" variant="outline" className="gap-1.5 h-9"
                style={{ backgroundColor: inputBg, borderColor: inputBorder, color: isLight ? '#3a3a5a' : '#d4d4d8' }}>
                <Mic className="h-4 w-4 text-violet-400" /> Sprache
              </Button>
              <Button onClick={() => setShowAddTask(true)} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white">
                <Plus className="h-4 w-4 mr-1" /> Neuer Task
              </Button>
              <Button onClick={() => setShowAddColumn(true)} size="sm" className="bg-violet-600 hover:bg-violet-500 text-white">
                <Plus className="h-4 w-4 mr-1" /> Spalte
              </Button>
            </div>
          </div>
        )}
      </div>

      {globalListView ? (
        <TaskGlobalListView
          columns={columns}
          tasks={filteredAndSortedTasks}
          onTaskClick={setSelectedTask}
          onToggleComplete={(task) => updateTaskMutation.mutate({ id: task.id, data: { completed: !task.completed } })}
        />
      ) : isMobile ? (
         /* Mobile: single column view */
         <DragDropContext onDragEnd={handleDragEnd}>
           <div className="flex-1 flex flex-col overflow-hidden">
             {columns[mobileColumnIndex] && (
               <>
                 {/* Mobile Column Tab Nav */}
                 <MobileColumnNav
                   columns={columns}
                   activeIndex={mobileColumnIndex}
                   onChangeIndex={setMobileColumnIndex}
                   getCount={(col) => filteredAndSortedTasks.filter(t => t.column_id === col.id && !t.completed).length}
                 />

                 {/* Mobile Tasks List */}
                 <div className="flex-1 overflow-y-auto px-3 py-3" style={{ backgroundColor: topBarBg }}>
                   <Droppable droppableId={columns[mobileColumnIndex].id} type="task">
                     {(provided) => (
                       <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                         {filteredAndSortedTasks.filter(t => t.column_id === columns[mobileColumnIndex].id && !t.completed).map((task, idx) => (
                           <Draggable key={task.id} draggableId={task.id} index={idx}>
                             {(provided) => (
                               <div
                                 ref={provided.innerRef}
                                 {...provided.draggableProps}
                                 {...provided.dragHandleProps}
                               >
                                 <TaskCard
                                   task={task}
                                   index={idx}
                                   onClick={setSelectedTask}
                                   onToggleComplete={(task) => updateTaskMutation.mutate({ id: task.id, data: { completed: !task.completed } })}
                                   currentUser={currentUser}
                                   priorities={priorities}
                                 />
                               </div>
                             )}
                           </Draggable>
                         ))}
                         {provided.placeholder}
                       </div>
                     )}
                   </Droppable>
                 </div>
               </>
             )}
           </div>
         </DragDropContext>
      ) : (
        <div className="flex-1 overflow-auto px-4 py-4 flex flex-col">
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="all-columns" direction="horizontal" type="column">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className="flex gap-3 h-full min-w-max">
                  {columns.map((column, index) => (
                    <TaskBoardColumn
                      key={column.id}
                      column={column}
                      index={index}
                      isCollapsed={collapsedColumns.has(column.id)}
                      onToggleCollapse={(id) => {
                        setCollapsedColumns(prev => {
                          const newSet = new Set(prev);
                          if (newSet.has(id)) { newSet.delete(id); } else { newSet.add(id); }
                          return newSet;
                        });
                      }}
                      tasks={filteredAndSortedTasks.filter(t => t.column_id === column.id)}
                      onRename={(id, name) => updateColumnMutation.mutate({ id, data: { name } })}
                      onDelete={(id) => deleteColumnMutation.mutate(id)}
                      onChangeColor={(col) => setEditingColumnColor(col)}
                      onTaskClick={setSelectedTask}
                      onToggleComplete={(task) => updateTaskMutation.mutate({ id: task.id, data: { completed: !task.completed } })}
                      currentUser={currentUser}
                      priorities={priorities}
                    />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      )}

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={(data) => {
            updateTaskMutation.mutate({ id: selectedTask.id, data });
            setSelectedTask({ ...selectedTask, ...data });
          }}
          onDelete={() => deleteTaskMutation.mutate(selectedTask.id)}
        />
      )}

      <AddTaskDialog
        open={showAddTask}
        onClose={() => setShowAddTask(false)}
        onAdd={(data) => createTaskMutation.mutate(data)}
        columns={columns}
      />

      <VoiceTaskDialog
        open={showVoiceTask}
        onClose={() => setShowVoiceTask(false)}
        onAdd={(data) => createTaskMutation.mutate(data)}
        columns={columns}
        priorities={priorities}
        currentUser={currentUser}
      />

      <AddColumnDialog
        open={showAddColumn}
        onClose={() => setShowAddColumn(false)}
        onAdd={handleAddColumn}
      />

      <EditColumnColorDialog
        open={!!editingColumnColor}
        onClose={() => setEditingColumnColor(null)}
        column={editingColumnColor}
        onSave={(color) => {
          updateColumnMutation.mutate({
            id: editingColumnColor.id,
            data: { color }
          });
          toast.success('Farbe geändert');
          setEditingColumnColor(null);
        }}
      />
    </div>
  );
}