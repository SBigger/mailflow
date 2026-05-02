// Wiederverwendbares Modal für Rapport-Erfassung / Bearbeitung
// Nutzt die gleichen Felder wie der Schnell-Rapport (Tagesansicht), aber
// als modaler Dialog – z.B. ausgelöst durch Klick auf Zeitslot im Kalender.
//
// Props:
//   open:       boolean
//   onClose:    () => void
//   onSave:     (payload) => Promise<void>  – payload kompatibel zu leTimeEntry.create/update
//   onDelete:   (id) => Promise<void>       – nur im Edit-Modus
//   initial:    { time_from, time_to, project_id, service_type_id, hours_internal, description, rate_snapshot, id? }
//   employee:   { id, billable_rate, employee_group:{ billable_rate } }
//   projects, serviceTypes, rateGroupRates, serviceRateHistory, currentDate

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X as XIcon, Save, Trash2, CornerDownLeft } from 'lucide-react';
import { resolveRateFor } from '@/lib/leApi';
import {
  Card, Combobox, Input, Field, fmt,
  artisBtn, artisPrimaryStyle, artisGhostStyle,
} from './shared';

const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);

const diffHours = (from, to) => {
  if (!from || !to) return null;
  const [fh, fm] = String(from).split(':').map(Number);
  const [th, tm] = String(to).split(':').map(Number);
  if ([fh, fm, th, tm].some((n) => Number.isNaN(n))) return null;
  const minutes = (th * 60 + tm) - (fh * 60 + fm);
  if (minutes <= 0) return null;
  return Math.round((minutes / 60) * 100) / 100;
};

export default function RapportEditDialog({
  open, onClose, onSave, onDelete,
  initial = null,
  employee, projects = [], serviceTypes = [],
  rateGroupRates = [], serviceRateHistory = [],
  currentDate,
}) {
  const isEdit = !!initial?.id;

  const [form, setForm] = useState(() => emptyRow());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const projectRef = useRef(null);

  function emptyRow() {
    return {
      id: null,
      time_from: '',
      time_to: '',
      project_id: '',
      service_type_id: '',
      hours_internal: '',
      description: '',
      rate_snapshot: '',
      rate_touched: false,
      hours_touched: false,
    };
  }

  // Initial setzen wenn Dialog öffnet
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initial) {
      setForm({
        id: initial.id ?? null,
        time_from: (initial.time_from ?? '').slice(0, 5),
        time_to: (initial.time_to ?? '').slice(0, 5),
        project_id: initial.project_id ?? '',
        service_type_id: initial.service_type_id ?? '',
        hours_internal: initial.hours_internal ?? '',
        description: initial.description ?? '',
        rate_snapshot: initial.rate_snapshot ?? '',
        rate_touched: !!initial.rate_snapshot,
        hours_touched: !!initial.hours_internal && !(initial.time_from && initial.time_to),
      });
    } else {
      setForm(emptyRow());
    }
    // Fokus auf Projekt-Feld
    setTimeout(() => projectRef.current?.focus(), 50);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const project = useMemo(
    () => projects.find((p) => p.id === form.project_id),
    [projects, form.project_id],
  );

  // Auto-Stunden aus Von/Bis (wenn nicht manuell überschrieben)
  useEffect(() => {
    if (!open) return;
    if (form.hours_touched) return;
    const h = diffHours(form.time_from, form.time_to);
    if (h != null) setForm((prev) => ({ ...prev, hours_internal: String(h) }));
  }, [form.time_from, form.time_to, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-Bis-Zeit wenn Stunden gesetzt aber Bis leer
  // (für Klick auf Zeitslot mit Default 30min)
  // → wir lassen das vorerst, User kann Bis manuell setzen

  // Auto-Satz aus Projekt/Mitarbeiter
  useEffect(() => {
    if (!open) return;
    if (form.rate_touched) return;
    if (!project) return;
    const r = resolveRateFor({
      project,
      employee,
      serviceTypeId: form.service_type_id,
      rateGroupId: project?.rate_group_id ?? null,
      date: currentDate,
      rateGroupRates,
      serviceRateHistory,
    });
    if (r > 0) setForm((prev) => ({ ...prev, rate_snapshot: String(r) }));
  }, [form.project_id, form.service_type_id, currentDate, employee?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const hoursNum = num(form.hours_internal);
  const rateNum = num(form.rate_snapshot);
  const total = hoursNum * rateNum;

  const canSave = !!form.project_id && !!form.service_type_id && hoursNum > 0 && !!form.description?.trim();

  const handleSave = async () => {
    if (!canSave) {
      setError('Projekt, Leistungsart, Stunden und Beschreibung sind Pflicht.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        id: form.id,
        time_from: form.time_from || null,
        time_to: form.time_to || null,
        project_id: form.project_id,
        service_type_id: form.service_type_id,
        hours_internal: hoursNum,
        rate_snapshot: rateNum || 0,
        description: form.description || null,
      });
      onClose?.();
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!form.id) return;
    if (!window.confirm('Eintrag wirklich löschen?')) return;
    setSaving(true);
    try {
      await onDelete?.(form.id);
      onClose?.();
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') onClose?.();
  };

  if (!open) return null;

  // Selected names für Anzeige im Header (Live-Vorschau)
  const projName = project?.name;
  const customerName = project?.customer?.company_name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(30,40,30,0.4)' }}
      onClick={onClose}
      onKeyDown={onKey}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-xl my-10"
        style={{ border: '1px solid #e4e7e4' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#eef0ee' }}>
          <div>
            <h3 className="text-base font-semibold" style={{ color: '#2d5a2d' }}>
              {isEdit ? 'Rapport bearbeiten' : 'Neuer Rapport'}
            </h3>
            {customerName && (
              <p className="text-xs text-zinc-500 mt-0.5">{customerName}{projName ? ` · ${projName}` : ''}</p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {/* Zeit-Zeile */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Von">
              <Input
                type="time"
                value={form.time_from}
                onChange={(e) => setForm({ ...form, time_from: e.target.value, hours_touched: false })}
                onKeyDown={onKey}
              />
            </Field>
            <Field label="Bis">
              <Input
                type="time"
                value={form.time_to}
                onChange={(e) => setForm({ ...form, time_to: e.target.value, hours_touched: false })}
                onKeyDown={onKey}
              />
            </Field>
            <Field label={<>Stunden <span className="text-red-500">*</span></>} hint="auto aus Von/Bis – überschreibbar">
              <Input
                type="number" step="0.25" min="0"
                value={form.hours_internal}
                onChange={(e) => setForm({ ...form, hours_internal: e.target.value, hours_touched: true })}
                onKeyDown={onKey}
                className="text-right tabular-nums"
              />
            </Field>
          </div>

          {/* Projekt + Leistungsart */}
          <Field label={<>Projekt <span className="text-red-500">*</span></>}>
            <Combobox
              ref={projectRef}
              value={form.project_id}
              onChange={(id) => setForm({ ...form, project_id: id, rate_touched: false })}
              onKeyDown={onKey}
              placeholder="Projekt suchen…"
              options={projects.map((p) => ({
                id: p.id, label: p.name,
                sublabel: p.customer?.company_name,
              }))}
            />
          </Field>
          <Field label={<>Leistungsart <span className="text-red-500">*</span></>}>
            <Combobox
              value={form.service_type_id}
              onChange={(id) => setForm({ ...form, service_type_id: id, rate_touched: false })}
              onKeyDown={onKey}
              placeholder="Leistungsart…"
              options={serviceTypes.map((s) => ({ id: s.id, label: s.name, sublabel: s.code }))}
            />
          </Field>

          {/* Beschreibung */}
          <Field label={<>Beschreibung <span className="text-red-500">*</span></>}>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              onKeyDown={onKey}
              placeholder="Was wurde gemacht…"
              style={!form.description?.trim() ? { borderColor: '#e8b4b4' } : undefined}
            />
          </Field>

          {/* Satz + Total */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stundenansatz CHF/h" hint="Auto aus Projekt – überschreibbar">
              <Input
                type="number" step="1" min="0"
                value={form.rate_snapshot}
                onChange={(e) => setForm({ ...form, rate_snapshot: e.target.value, rate_touched: true })}
                onKeyDown={onKey}
                className="text-right tabular-nums"
              />
            </Field>
            <Field label="Total CHF">
              <div
                className="border rounded px-2 py-1.5 text-sm text-right tabular-nums font-semibold"
                style={{ borderColor: '#bfd3bf', background: '#f5faf5', color: '#2d5a2d' }}
              >
                {fmt.chf(total)}
              </div>
            </Field>
          </div>

          {error && (
            <div className="rounded px-3 py-2 text-xs" style={{ background: '#fce4e4', color: '#8a2d2d', border: '1px solid #e8b4b4' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t" style={{ borderColor: '#eef0ee' }}>
          <div>
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border text-red-700 hover:bg-red-50"
                style={{ borderColor: '#e8b4b4' }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Löschen
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={artisBtn.ghost} style={artisGhostStyle}>
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className={artisBtn.primary}
              style={{ ...artisPrimaryStyle, opacity: (!canSave || saving) ? 0.55 : 1 }}
            >
              <Save className="w-4 h-4" /> {saving ? 'Speichern…' : 'Speichern (Enter)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
