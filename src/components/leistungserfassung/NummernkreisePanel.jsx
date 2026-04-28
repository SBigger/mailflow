import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Info, Hash } from 'lucide-react';
import { leNumberSequence } from '@/lib/leApi';
import {
  Card,
  Chip,
  Input,
  Field,
  PanelLoader,
  PanelError,
  PanelHeader,
  artisBtn,
  artisPrimaryStyle,
} from './shared';

const KIND_LABEL = {
  invoice: 'Rechnung',
  dunning: 'Mahnung',
  credit: 'Gutschrift',
};

const KIND_TONE = {
  invoice: 'green',
  dunning: 'orange',
  credit: 'blue',
};

// Beispielausgabe nach Format-Tokens
function preview(format, padding, currentValue) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const next = String((Number(currentValue) || 0) + 1).padStart(Number(padding) || 1, '0');
  return (format || '')
    .replaceAll('{YYYY}', yyyy)
    .replaceAll('{YY}', yy)
    .replaceAll('{MM}', mm)
    .replaceAll('{NNNN}', next);
}

function Row({ row, onSave, isSaving }) {
  const [local, setLocal] = useState({
    format: row.format ?? '',
    padding: row.padding ?? 4,
    reset_yearly: !!row.reset_yearly,
  });
  const dirty =
    local.format !== (row.format ?? '') ||
    Number(local.padding) !== Number(row.padding ?? 4) ||
    local.reset_yearly !== !!row.reset_yearly;

  return (
    <tr className="border-t align-top" style={{ borderColor: '#eef1ee' }}>
      <td className="px-3 py-2">
        <Chip tone={KIND_TONE[row.kind] || 'neutral'}>{KIND_LABEL[row.kind] || row.kind}</Chip>
      </td>
      <td className="px-3 py-2">
        <Input
          value={local.format}
          onChange={(e) => setLocal((l) => ({ ...l, format: e.target.value }))}
          className="font-mono"
        />
        <div className="text-[10px] text-zinc-400 mt-1 font-mono">
          Vorschau: {preview(local.format, local.padding, row.current_value)}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-zinc-500">{row.current_value ?? 0}</td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={local.reset_yearly}
          onChange={(e) => setLocal((l) => ({ ...l, reset_yearly: e.target.checked }))}
          style={{ accentColor: '#7a9b7f' }}
        />
      </td>
      <td className="px-3 py-2">
        <Input
          type="number" min={1} max={10}
          value={local.padding}
          onChange={(e) => setLocal((l) => ({ ...l, padding: e.target.value }))}
          className="text-center"
          style={{ width: 64 }}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          disabled={!dirty || isSaving}
          onClick={() =>
            onSave(row.id, {
              format: local.format,
              padding: Number(local.padding) || 1,
              reset_yearly: local.reset_yearly,
            })
          }
          className={artisBtn.primary}
          style={{ ...artisPrimaryStyle, opacity: !dirty || isSaving ? 0.5 : 1 }}
        >
          <Save className="w-3.5 h-3.5" /> Speichern
        </button>
      </td>
    </tr>
  );
}

export default function NummernkreisePanel() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['le', 'number_sequence'],
    queryFn: leNumberSequence.list,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }) => leNumberSequence.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['le', 'number_sequence'] });
      toast.success('Nummernkreis aktualisiert');
    },
    onError: (e) => toast.error('Fehler: ' + (e?.message ?? e)),
  });

  return (
    <div>
      <PanelHeader
        title="Nummernkreise"
        subtitle="Format & Verhalten für Rechnungs-, Mahn- & Gutschrift-Nummern"
      />

      <Card className="p-3 mb-4 flex items-start gap-2 text-xs" style={{ background: '#f1f5f1', borderColor: '#cfdccf', color: '#3d4a3d' }}>
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          Nummern werden automatisch beim Finalisieren vergeben. Format-Tokens:
          <code className="mx-1 px-1 bg-white/70 rounded">{'{YYYY}'}</code>
          <code className="mx-1 px-1 bg-white/70 rounded">{'{YY}'}</code>
          <code className="mx-1 px-1 bg-white/70 rounded">{'{MM}'}</code>
          <code className="mx-1 px-1 bg-white/70 rounded">{'{NNNN}'}</code>
          – z.B. <code className="bg-white/70 px-1 rounded">RE-{'{YYYY}'}-{'{NNNN}'}</code> → RE-{new Date().getFullYear()}-0001
        </div>
      </Card>

      {isLoading ? (
        <PanelLoader />
      ) : error ? (
        <PanelError error={error} onRetry={refetch} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500" style={{ background: '#f6f8f6' }}>
                  <th className="px-3 py-2 font-semibold">Typ</th>
                  <th className="px-3 py-2 font-semibold">Format</th>
                  <th className="px-3 py-2 font-semibold text-right">Aktueller Wert</th>
                  <th className="px-3 py-2 font-semibold text-center">Reset jährlich</th>
                  <th className="px-3 py-2 font-semibold">Padding</th>
                  <th className="px-3 py-2 font-semibold text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-zinc-400">
                    Keine Nummernkreise definiert. Migration <code>0001_le_core_schema.sql</code> ausgeführt?
                  </td></tr>
                ) : (
                  data.map((row) => (
                    <Row
                      key={row.id}
                      row={row}
                      isSaving={updateMut.isPending}
                      onSave={(id, patch) => updateMut.mutate({ id, patch })}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
