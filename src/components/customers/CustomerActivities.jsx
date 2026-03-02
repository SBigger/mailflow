import React, { useEffect, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { entities, functions, auth } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";

export default function CustomerActivities({ customer, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === 'light';
  const isArtis = theme === 'artis';
  const { data: templates = [] } = useQuery({
    queryKey: ["activityTemplates"],
    queryFn: () => entities.ActivityTemplate.list("order"),
  });

  // Merge templates with existing customer activities
  // Keep completed state from existing activities, add missing ones from templates
  const mergedActivities = templates.map((template) => {
    const existing = (customer.activities || []).find(a => a.name === template.name);
    return {
      name: template.name,
      completed: existing?.completed ?? false,
      order: template.order ?? 0,
    };
  });

  const activities = mergedActivities.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const toggle = (name) => {
    const updated = activities.map(a => a.name === name ? { ...a, completed: !a.completed } : a);
    onUpdate({ activities: updated });
  };

  if (activities.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4 text-center">
        Keine Tätigkeiten definiert.<br />
        <span className="text-xs text-gray-400">Tätigkeiten werden in den Einstellungen verwaltet.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {activities.map((activity) => (
        <button
          key={activity.name}
          onClick={() => toggle(activity.name)}
          title={activity.completed ? "Zurücksetzen" : "Als erledigt markieren"}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
            activity.completed
              ? "bg-green-600 border-green-500 text-white shadow-sm"
              : ""
          }`}
          style={!activity.completed ? {
            backgroundColor: isArtis ? '#edf2ed' : isLight ? '#ebebf4' : '#f3f4f6',
            borderColor: isArtis ? '#bfcfbf' : isLight ? '#c8c8dc' : '#d1d5db',
            color: isArtis ? '#3d503d' : isLight ? '#3a3a5a' : '#374151'
          } : {}}
        >
          {activity.name}
        </button>
      ))}
    </div>
  );
}