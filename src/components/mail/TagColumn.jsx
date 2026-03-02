import React, { useState } from "react";
import { Draggable, Droppable } from "@hello-pangea/dnd";
import { MoreHorizontal, Mail, ChevronLeft, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import MailCard from "./MailCard";
import TaskCard from "../tasks/TaskCard";

export default function TagColumn({ tagName, mails, tasks, onMailClick, onTaskClick, onToggleCollapse, isCollapsed, index }) {
  const totalCount = mails.length + (tasks?.length || 0);
  
  if (isCollapsed) {
    return (
      <Draggable draggableId={`tag-${tagName}`} index={index}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            className="flex-shrink-0 w-12 flex flex-col bg-zinc-900/40 backdrop-blur-sm rounded-2xl border border-zinc-800/60 items-center py-4 gap-2 cursor-pointer hover:bg-zinc-900/60 transition-colors"
            style={{ borderLeftColor: '#a78bfa', ...provided.draggableProps.style }}
            onClick={() => onToggleCollapse(tagName)}
          >
            <div {...provided.dragHandleProps} className="w-full flex justify-center">
              <MoreHorizontal className="h-4 w-4 text-zinc-600" />
            </div>
            <div className="flex-1 flex items-center">
              <span className="text-xs font-medium text-zinc-400 [writing-mode:vertical-rl] rotate-180">
                {tagName}
              </span>
            </div>
            <span className="text-xs text-zinc-500 bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
              {totalCount}
            </span>
          </div>
        )}
      </Draggable>
    );
  }

  return (
    <Draggable draggableId={`tag-${tagName}`} index={index}>
      {(provided) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className="flex flex-col min-w-[320px] max-w-[340px] h-full"
        >
          {/* Header */}
          <div {...provided.dragHandleProps} className="flex items-center justify-between px-4 py-3 mb-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => onToggleCollapse(tagName)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
              <h3 className="text-sm font-semibold text-zinc-200 tracking-wide uppercase">
                {tagName}
              </h3>
              <span className="text-xs font-medium text-zinc-500 bg-zinc-800/60 px-2 py-0.5 rounded-full">
                {totalCount}
              </span>
            </div>
          </div>

          {/* Droppable Area */}
          <div className="flex-1 px-2 pb-2 space-y-4 overflow-y-auto rounded-xl">
            {/* E-Mails Section */}
            <div>
              <div className="flex items-center gap-2 px-2 mb-2">
                <Mail className="h-3.5 w-3.5 text-zinc-500" />
                <span className="text-xs font-medium text-zinc-400 uppercase">E-Mails ({mails.length})</span>
              </div>
              <Droppable droppableId={`tag-${tagName}`}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`space-y-2.5 transition-colors duration-200 ${
                      snapshot.isDraggingOver ? "bg-violet-500/5 rounded-lg p-2" : ""
                    }`}
                    style={{ minHeight: 60 }}
                  >
                    {mails.length === 0 && !snapshot.isDraggingOver && (
                      <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
                        <Mail className="h-6 w-6 mb-1 opacity-40" />
                        <span className="text-xs">Keine E-Mails</span>
                      </div>
                    )}
                    {mails.map((mail, idx) => (
                      <Draggable key={mail.id} draggableId={mail.id} index={idx}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                          >
                            <MailCard mail={mail} isDragging={snapshot.isDragging} onClick={() => onMailClick(mail)} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>

            {/* Tasks Section */}
            {tasks && tasks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-2 mb-2">
                  <CheckSquare className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-xs font-medium text-zinc-400 uppercase">Tasks ({tasks.length})</span>
                </div>
                <div className="space-y-2.5">
                  {tasks.map((task) => (
                    <div key={task.id} onClick={() => onTaskClick?.(task)}>
                      <TaskCard task={task} onClick={() => onTaskClick?.(task)} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}