import React, { useState, useMemo, useEffect, useContext } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import { MoreHorizontal, Pencil, Trash2, Check, X, Mail, ChevronLeft, ChevronRight, Palette, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeContext } from "@/Layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import MailCard from "./MailCard";
import DateSeparator from "./DateSeparator";
import MailListViewOverlay from "./MailListViewOverlay";
import { 
  isToday, 
  isYesterday, 
  isThisWeek, 
  startOfWeek, 
  endOfWeek, 
  subWeeks, 
  isThisMonth,
  startOfDay,
  parseISO
} from "date-fns";

export default function KanbanColumn({ column, mails, onRename, onDelete, onMailClick, index, isCollapsed, onToggleCollapse, onChangeColor, onMailDelete, globalDateCollapse, showDateGrouping, columnDragHandleProps }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(column.name);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showListView, setShowListView] = useState(false);
  
  // Date separator collapse state (persisted in localStorage)
  const [collapsedDates, setCollapsedDates] = useState(() => {
    try {
      const saved = localStorage.getItem(`column-${column.id}-collapsed-dates`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Persist collapsed state
  useEffect(() => {
    localStorage.setItem(
      `column-${column.id}-collapsed-dates`, 
      JSON.stringify([...collapsedDates])
    );
  }, [collapsedDates, column.id]);

  // Handle global collapse/expand
  useEffect(() => {
    if (globalDateCollapse === 'expand') {
      setCollapsedDates(new Set());
    } else if (globalDateCollapse === 'collapse') {
      setCollapsedDates(new Set(['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'older']));
    }
  }, [globalDateCollapse]);

  const handleRename = () => {
    if (editName.trim()) {
      onRename(column.id, editName.trim());
    }
    setIsEditing(false);
  };

  const accentColor = column.color || "#6366f1";
  
  // Split mails into active and completed
  const activeMails = mails.filter(m => !m.is_completed);
  const completedMails = mails.filter(m => m.is_completed);

  // Group mails by date categories
  const groupedMails = useMemo(() => {
    const groups = {
      today: [],
      yesterday: [],
      thisWeek: [],
      lastWeek: [],
      thisMonth: [],
      older: []
    };

    const now = new Date();
    const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });

    activeMails.forEach(mail => {
      const mailDate = new Date(mail.received_date);
      
      if (isToday(mailDate)) {
        groups.today.push(mail);
      } else if (isYesterday(mailDate)) {
        groups.yesterday.push(mail);
      } else if (isThisWeek(mailDate, { weekStartsOn: 1 })) {
        groups.thisWeek.push(mail);
      } else if (mailDate >= lastWeekStart && mailDate <= lastWeekEnd) {
        groups.lastWeek.push(mail);
      } else if (isThisMonth(mailDate)) {
        groups.thisMonth.push(mail);
      } else {
        groups.older.push(mail);
      }
    });

    return groups;
  }, [activeMails]);

  const toggleDateCollapse = (dateKey) => {
    setCollapsedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateKey)) {
        newSet.delete(dateKey);
      } else {
        newSet.add(dateKey);
      }
      return newSet;
    });
  };

  const collapseAll = () => {
    setCollapsedDates(new Set(['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'older']));
  };

  const expandAll = () => {
    setCollapsedDates(new Set());
  };

  // Collapsed view
  if (isCollapsed) {
    return (
      <div
        className="flex-shrink-0 w-12 flex flex-col backdrop-blur-sm rounded-2xl border items-center py-4 gap-2 cursor-pointer transition-colors"
        style={{ 
          borderLeftColor: accentColor,
          backgroundColor: isLight ? '#ffffff' : 'rgba(24,24,27,0.4)',
          borderColor: isLight ? '#d4d4e8' : 'rgba(63,63,70,0.6)',
        }}
        onClick={() => onToggleCollapse(column.id)}
      >
        <div className="w-full flex justify-center">
          <MoreHorizontal className="h-4 w-4" style={{ color: isLight ? '#9090b8' : '#52525b' }} />
        </div>
            <div className="flex-1 flex items-center">
              <span className="text-xs font-medium [writing-mode:vertical-lr] rotate-180" style={{ color: isLight ? '#5a5a7a' : '#a1a1aa' }}>
                {column.name}
              </span>
            </div>
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ color: isLight ? '#7a7a9a' : '#71717a', backgroundColor: isLight ? '#e8e8f4' : 'rgba(39,39,42,0.6)' }}>
              {mails.length}
            </span>
            <ChevronRight className="h-4 w-4" style={{ color: isLight ? '#9090b8' : '#71717a' }} />
            </div>
            );
            }

  // Expanded view
  return (
    <div className="flex flex-col min-w-[320px] max-w-[340px] h-full">
      {/* Column Header */}
      <div
        {...(columnDragHandleProps || {})}
        className="flex items-center justify-between px-4 py-3 mb-3"
      >
            <div className="flex items-center gap-3">
              <button
                onClick={() => onToggleCollapse(column.id)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: accentColor }}
              />
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 w-36 text-sm bg-white/5 border-white/10 text-white"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleRename()}
                  />
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-emerald-400 hover:text-emerald-300" onClick={handleRename}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-zinc-400 hover:text-zinc-300" onClick={() => setIsEditing(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <h3 className="text-sm font-semibold tracking-wide uppercase" style={{ color: isArtis ? '#2d3a2d' : isLight ? '#1a1a2e' : '#e4e4e7' }}>
                  {column.name}
                </h3>
              )}
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: isArtis ? '#6b826b' : isLight ? '#7a7a9a' : '#71717a', backgroundColor: isArtis ? 'rgba(122,155,127,0.12)' : isLight ? 'rgba(100,100,180,0.12)' : 'rgba(39,39,42,0.6)' }}>
                {mails.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                title="Listenansicht"
                onClick={() => setShowListView(true)}
              >
                <List className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-300 hover:bg-white/5">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" style={{ backgroundColor: isLight ? '#ffffff' : '#18181b', borderColor: isLight ? '#d4d4e8' : '#3f3f46', color: isLight ? '#1a1a2e' : '#e4e4e7' }}>
                  <DropdownMenuItem onClick={() => { setEditName(column.name); setIsEditing(true); }} className="hover:bg-white/5">
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Umbenennen
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onChangeColor?.(column)} className="hover:bg-white/5">
                    <Palette className="h-3.5 w-3.5 mr-2" /> Farbe ändern
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDelete(column.id)} className="text-red-400 hover:bg-red-500/10 hover:text-red-300">
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Droppable Area */}
          <Droppable droppableId={column.id} type="MAIL">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`flex-1 px-2 pb-2 space-y-2.5 overflow-y-auto rounded-xl transition-colors duration-200 ${
                  snapshot.isDraggingOver ? "bg-indigo-500/5" : ""
                }`}
                style={{ minHeight: 80 }}
              >
                {mails.length === 0 && !snapshot.isDraggingOver && (
                  <div className="flex flex-col items-center justify-center py-12" style={{ color: isLight ? '#a0a0c0' : '#52525b' }}>
                    <Mail className="h-8 w-8 mb-2 opacity-40" />
                    <span className="text-xs">Keine E-Mails</span>
                  </div>
                )}
                
                {/* No Grouping or Non-Outlook Column - Simple List */}
                {(!showDateGrouping || column.name !== "Outlook") && activeMails.map((mail, index) => (
                  <Draggable key={mail.id} draggableId={mail.id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                      >
                        <div {...provided.dragHandleProps}>
                          <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} onDelete={onMailDelete} />
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                
                {/* Date-grouped Mails - Only for Outlook Column */}
                {showDateGrouping && column.name === "Outlook" && groupedMails.today.length > 0 && (
                  <>
                    <DateSeparator
                      title="Heute"
                      count={groupedMails.today.length}
                      isCollapsed={collapsedDates.has('today')}
                      onToggle={() => toggleDateCollapse('today')}
                    />
                    {!collapsedDates.has('today') && groupedMails.today.map((mail, index) => (
                       <Draggable key={mail.id} draggableId={mail.id} index={index}>
                         {(provided, snapshot) => (
                           <div
                             ref={provided.innerRef}
                             {...provided.draggableProps}
                           >
                             <div {...provided.dragHandleProps}>
                               <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} onDelete={onMailDelete} />
                             </div>
                           </div>
                         )}
                       </Draggable>
                     ))}
                  </>
                )}

                {showDateGrouping && column.name === "Outlook" && groupedMails.yesterday.length > 0 && (
                  <>
                    <DateSeparator
                      title="Gestern"
                      count={groupedMails.yesterday.length}
                      isCollapsed={collapsedDates.has('yesterday')}
                      onToggle={() => toggleDateCollapse('yesterday')}
                    />
                    {!collapsedDates.has('yesterday') && groupedMails.yesterday.map((mail, index) => {
                       const totalIndex = groupedMails.today.length + index;
                       return (
                        <Draggable key={mail.id} draggableId={mail.id} index={totalIndex}>
                         {(provided, snapshot) => (
                           <div
                             ref={provided.innerRef}
                             {...provided.draggableProps}
                           >
                             <div {...provided.dragHandleProps}>
                               <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} onDelete={onMailDelete} />
                             </div>
                           </div>
                         )}
                       </Draggable>
                       );
                    })}
                  </>
                )}

                {showDateGrouping && column.name === "Outlook" && groupedMails.thisWeek.length > 0 && (
                  <>
                    <DateSeparator
                      title="Diese Woche"
                      count={groupedMails.thisWeek.length}
                      isCollapsed={collapsedDates.has('thisWeek')}
                      onToggle={() => toggleDateCollapse('thisWeek')}
                    />
                    {!collapsedDates.has('thisWeek') && groupedMails.thisWeek.map((mail, index) => {
                        const totalIndex = groupedMails.today.length + groupedMails.yesterday.length + index;
                        return (
                        <Draggable key={mail.id} draggableId={mail.id} index={totalIndex}>
                         {(provided, snapshot) => (
                           <div
                             ref={provided.innerRef}
                             {...provided.draggableProps}
                           >
                             <div {...provided.dragHandleProps}>
                               <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} onDelete={onMailDelete} />
                             </div>
                             </div>
                             )}
                             </Draggable>
                             );
                             })}
                            </>
                            )}

                            {showDateGrouping && column.name === "Outlook" && groupedMails.lastWeek.length > 0 && (
                  <>
                    <DateSeparator
                      title="Letzte Woche"
                      count={groupedMails.lastWeek.length}
                      isCollapsed={collapsedDates.has('lastWeek')}
                      onToggle={() => toggleDateCollapse('lastWeek')}
                    />
                    {!collapsedDates.has('lastWeek') && groupedMails.lastWeek.map((mail, index) => {
                       const totalIndex = groupedMails.today.length + groupedMails.yesterday.length + groupedMails.thisWeek.length + index;
                       return (
                       <Draggable key={mail.id} draggableId={mail.id} index={totalIndex}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                          >
                            <div {...provided.dragHandleProps}>
                              <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} onDelete={onMailDelete} />
                            </div>
                            </div>
                            )}
                            </Draggable>
                            );
                            })}
                            </>
                            )}

                            {showDateGrouping && column.name === "Outlook" && groupedMails.thisMonth.length > 0 && (
                  <>
                    <DateSeparator
                      title="Diesen Monat"
                      count={groupedMails.thisMonth.length}
                      isCollapsed={collapsedDates.has('thisMonth')}
                      onToggle={() => toggleDateCollapse('thisMonth')}
                    />
                    {!collapsedDates.has('thisMonth') && groupedMails.thisMonth.map((mail, index) => {
                        const totalIndex = groupedMails.today.length + groupedMails.yesterday.length + groupedMails.thisWeek.length + groupedMails.lastWeek.length + index;
                        return (
                        <Draggable key={mail.id} draggableId={mail.id} index={totalIndex}>
                         {(provided, snapshot) => (
                           <div
                             ref={provided.innerRef}
                             {...provided.draggableProps}
                           >
                             <div {...provided.dragHandleProps}>
                               <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} onDelete={onMailDelete} />
                             </div>
                             </div>
                             )}
                             </Draggable>
                             );
                             })}
                            </>
                            )}

                            {showDateGrouping && column.name === "Outlook" && groupedMails.older.length > 0 && (
                  <>
                    <DateSeparator
                      title="Älter"
                      count={groupedMails.older.length}
                      isCollapsed={collapsedDates.has('older')}
                      onToggle={() => toggleDateCollapse('older')}
                    />
                    {!collapsedDates.has('older') && groupedMails.older.map((mail, index) => {
                       const totalIndex = groupedMails.today.length + groupedMails.yesterday.length + groupedMails.thisWeek.length + groupedMails.lastWeek.length + groupedMails.thisMonth.length + index;
                       return (
                       <Draggable key={mail.id} draggableId={mail.id} index={totalIndex}>
                         {(provided, snapshot) => (
                           <div
                             ref={provided.innerRef}
                             {...provided.draggableProps}
                           >
                             <div {...provided.dragHandleProps}>
                               <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} onDelete={onMailDelete} />
                             </div>
                           </div>
                         )}
                       </Draggable>
                       );
                       })}
                  </>
                )}
                
                {/* Completed Section Divider */}
                {completedMails.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowCompleted(!showCompleted)}
                      className="w-full flex items-center gap-2 py-2 px-3 text-xs font-medium text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800/40 rounded-lg transition-colors mt-4"
                    >
                      {showCompleted ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      <div className="flex-1 h-px bg-zinc-800/60" />
                      <span>Erledigt ({completedMails.length})</span>
                      <div className="flex-1 h-px bg-zinc-800/60" />
                    </button>
                    
                    {/* Completed Mails */}
                    {showCompleted && completedMails.map((mail, index) => (
                       <Draggable key={mail.id} draggableId={mail.id} index={activeMails.length + index}>
                         {(provided, snapshot) => (
                           <div
                             ref={provided.innerRef}
                             {...provided.draggableProps}
                             {...provided.dragHandleProps}
                           >
                             <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} onDelete={onMailDelete} />
                           </div>
                         )}
                       </Draggable>
                     ))}
                  </>
                )}
                
                {provided.placeholder}
                </div>
                )}
                </Droppable>
                {showListView && (
                <MailListViewOverlay
                column={column}
                mails={mails}
                onClose={() => setShowListView(false)}
                onMailClick={(mail) => { onMailClick(mail); setShowListView(false); }}
                />
                )}
                </div>
                );
                }