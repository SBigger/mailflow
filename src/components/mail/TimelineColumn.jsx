import React from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import { ChevronDown, ChevronRight } from "lucide-react";
import MailCard from "./MailCard";

export default function TimelineColumn({ 
  columnId, 
  title, 
  date, 
  mails, 
  isCollapsed, 
  onToggleCollapse, 
  onMailClick 
}) {
  if (isCollapsed) {
    return (
      <div className="flex-shrink-0 w-14 bg-zinc-900/40 rounded-2xl border border-zinc-800/40 p-3">
        <button
          onClick={() => onToggleCollapse(columnId)}
          className="flex flex-col items-center gap-2 w-full"
        >
          <ChevronRight className="h-4 w-4 text-zinc-500" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-semibold text-zinc-400 writing-mode-vertical transform rotate-180">
              {title}
            </span>
            <span className="text-xs text-zinc-600 bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
              {mails.length}
            </span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 w-80 flex flex-col">
      <div className="bg-zinc-900/60 backdrop-blur-sm rounded-t-2xl border border-zinc-800/40 border-b-0 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
            {date && <p className="text-xs text-zinc-500 mt-0.5">{date}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 bg-zinc-800/60 px-2 py-1 rounded-lg">
              {mails.length}
            </span>
            <button
              onClick={() => onToggleCollapse(columnId)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 hover:bg-zinc-800/60 rounded-lg"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <Droppable droppableId={columnId}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 overflow-y-auto bg-zinc-950/40 backdrop-blur-sm rounded-b-2xl border border-zinc-800/40 border-t-0 p-3 transition-colors ${
              snapshot.isDraggingOver ? "bg-indigo-500/5 border-indigo-500/30" : ""
            }`}
            style={{ minHeight: "200px", maxHeight: "calc(100vh - 300px)" }}
          >
            {mails.map((mail, index) => (
              <Draggable key={mail.id} draggableId={mail.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                  >
                    <MailCard
                      mail={mail}
                      isDragging={snapshot.isDragging}
                      onClick={() => onMailClick(mail)}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {mails.length === 0 && (
              <div className="text-center text-zinc-600 text-sm py-8">
                Keine E-Mails
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}