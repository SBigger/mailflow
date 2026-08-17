/**
 * Benutzerverwaltung – Mandant-spezifische Zugriffsverwaltung
 * Nur für Admins sichtbar und bedienbar.
 *
 * Features:
 *  - Aktuelle Benutzer auflisten mit Rolle + Entfernen
 *  - Rolle ändern per Dropdown
 *  - Neuen Benutzer aus bestehenden System-Usern hinzufügen
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';

// ── Rollen-Definitionen ───────────────────────────────────────────
const ROLLEN = [
  { value: 'admin',      label: 'Administrator', desc: 'Voller Zugriff + Benutzerverwaltung', bg: '#ede9fe', color: '#5b21b6' },
  { value: 'buchhalter', label: 'Buchhalter',    desc: 'Lesen und Schreiben, kein Admin',     bg: '#dcfce7', color: '#166534' },
  { value: 'readonly',   label: 'Nur lesen',     desc: 'Nur Auswertungen ansehen',            bg: '#f3f4f6', color: '#374151' },
];

function RolleBadge({ role }) {
  const r = ROLLEN.find(x => x.value === role) ?? ROLLEN[2];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 6, background: r.bg, color: r.color }}>
      {r.label}
    </span>
  );
}

// ── Hilfsfunktionen ───────────────────────────────────────────────
const initials = (name) => name?.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('de-CH') : '—';

export default function Benutzerverwaltung() {
  const { mandant, isAdmin } = useMandant();

  const [users,    setUsers]    = useState([]);
  const [allUsers, setAllUsers] = useState([]);   // Alle System-User (für Suche)
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(null); // user_id der gerade gespeichert wird
  const [msg,      setMsg]      = useState(null);

  // "Hinzufügen"-Panel
  const [search,   setSearch]   = useState('');
  const [selUser,  setSelUser]  = useState(null); // { id, email, display_name }
  const [selRole,  setSelRole]  = useState('buchhalter');
  const [adding,   setAdding]   = useState(false);
  const [showDrop, setShowDrop] = useState(false);

  // Aktuell eingeloggter User (um "du selbst" zu markieren)
  const [myId, setMyId] = useState(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data?.user?.id ?? null));
  }, []);

  // ── Laden ──────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    if (!mandant) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fibu_list_mandant_users', { p_mandant_id: mandant.id });
      if (error) throw error;
      setUsers(data ?? []);
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [mandant?.id]);

  const loadAllUsers = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke('getAllUsers');
      const list = (data?.users ?? []).map(u => ({
        id:           u.id,
        email:        u.email,
        // getAllUsers liefert profiles-Zeilen (kein user_metadata)
        display_name: u.full_name || u.email?.split('@')[0] || '?',
      }));
      setAllUsers(list);
    } catch {
      // Kein kritischer Fehler – Suche bleibt leer
    }
  }, []);

  useEffect(() => {
    loadUsers();
    if (isAdmin) loadAllUsers();
  }, [loadUsers, loadAllUsers, isAdmin]);

  // ── Rolle ändern ───────────────────────────────────────────────
  async function handleRoleChange(userId, newRole) {
    setSaving(userId);
    setMsg(null);
    try {
      const { error } = await supabase.rpc('fibu_set_mandant_user_role', {
        p_mandant_id:     mandant.id,
        p_target_user_id: userId,
        p_role:           newRole,
      });
      if (error) throw error;
      await loadUsers();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setSaving(null);
    }
  }

  // ── Entfernen ─────────────────────────────────────────────────
  async function handleRemove(userId, displayName) {
    if (!window.confirm(`Zugriff von „${displayName}" wirklich entfernen?`)) return;
    setSaving(userId);
    setMsg(null);
    try {
      const { error } = await supabase.rpc('fibu_remove_mandant_user', {
        p_mandant_id:     mandant.id,
        p_target_user_id: userId,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: `${displayName} wurde entfernt.` });
      await loadUsers();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setSaving(null);
    }
  }

  // ── Hinzufügen ────────────────────────────────────────────────
  async function handleAdd() {
    if (!selUser) return;
    setAdding(true);
    setMsg(null);
    try {
      const { error } = await supabase.rpc('fibu_set_mandant_user_role', {
        p_mandant_id:     mandant.id,
        p_target_user_id: selUser.id,
        p_role:           selRole,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: `${selUser.display_name} wurde als ${ROLLEN.find(r => r.value === selRole)?.label} hinzugefügt.` });
      setSelUser(null);
      setSearch('');
      await loadUsers();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setAdding(false);
    }
  }

  // ── Suche / Dropdown ──────────────────────────────────────────
  const existingIds = new Set(users.map(u => u.user_id));
  const filtered = allUsers.filter(u =>
    !existingIds.has(u.id) &&
    (u.email?.toLowerCase().includes(search.toLowerCase()) ||
     u.display_name?.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 8);

  // ── Stile ─────────────────────────────────────────────────────
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 8, padding: '7px 11px', fontSize: 13, color: '#1a1a2e', outline: 'none' };
  const th  = { padding: '9px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', background: '#fafcfa', textAlign: 'left', borderBottom: '2px solid #e4e9e4' };
  const td  = { padding: '10px 14px', borderBottom: '1px solid #f0f3f0', fontSize: 13, verticalAlign: 'middle' };

  if (!isAdmin) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ textAlign: 'center', color: '#6b826b' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Kein Zugriff</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Nur Administratoren können Benutzer verwalten.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>👥</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Benutzerverwaltung</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>
            Zugriff auf «{mandant?.name}» verwalten · {users.length} Benutzer
          </div>
        </div>
      </div>

      {/* Meldung */}
      {msg && (
        <div style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12.5, background: msg.type === 'ok' ? '#f0f7f0' : '#fdf0f0', color: msg.type === 'ok' ? '#166534' : '#8a2d2d', borderBottom: '1px solid #e4e9e4' }}>
          {msg.text}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Aktuelle Benutzer ─────────────────────────────────── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e4e9e4', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 13.5, color: '#1a1a2e' }}>
            Benutzer mit Zugriff
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a394' }}>Lädt…</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Benutzer</th>
                  <th style={th}>Rolle</th>
                  <th style={{ ...th, width: 100 }}>Seit</th>
                  <th style={{ ...th, width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isMe      = u.user_id === myId;
                  const isSaving  = saving === u.user_id;
                  const adminCount = users.filter(x => x.role === 'admin').length;
                  const cantRemove = isMe || (u.role === 'admin' && adminCount <= 1);

                  return (
                    <tr key={u.user_id} style={{ background: isMe ? '#f7fdf7' : '#fff' }}>
                      {/* Avatar + Name */}
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e8f0e8', color: '#4a6a4f', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {initials(u.display_name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#1a1a2e' }}>
                              {u.display_name}
                              {isMe && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#7a9b7f', background: '#e8f4e8', padding: '1px 6px', borderRadius: 4 }}>Du</span>}
                            </div>
                            <div style={{ fontSize: 11.5, color: '#94a394' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Rolle ändern */}
                      <td style={td}>
                        {isMe ? (
                          <RolleBadge role={u.role} />
                        ) : (
                          <select
                            value={u.role}
                            disabled={isSaving}
                            onChange={e => handleRoleChange(u.user_id, e.target.value)}
                            style={{ ...inp, padding: '4px 8px', fontSize: 12, cursor: 'pointer', width: 'auto' }}
                          >
                            {ROLLEN.map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        )}
                        {isSaving && <span style={{ marginLeft: 6, fontSize: 11, color: '#94a394' }}>…</span>}
                      </td>

                      {/* Datum */}
                      <td style={{ ...td, color: '#6b826b', fontSize: 12 }}>{fmtDate(u.created_at)}</td>

                      {/* Entfernen */}
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button
                          onClick={() => handleRemove(u.user_id, u.display_name)}
                          disabled={cantRemove || isSaving}
                          title={cantRemove ? (isMe ? 'Du kannst dich nicht selbst entfernen' : 'Letzter Admin kann nicht entfernt werden') : 'Zugriff entfernen'}
                          style={{
                            padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5',
                            background: cantRemove ? '#f9f9f9' : '#fff5f5',
                            color: cantRemove ? '#c5cdc5' : '#dc2626',
                            fontSize: 12, cursor: cantRemove ? 'not-allowed' : 'pointer',
                            opacity: isSaving ? 0.5 : 1,
                          }}
                        >
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#94a394' }}>Keine Benutzer</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Benutzer hinzufügen ───────────────────────────────── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e4e9e4', padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1a1a2e', marginBottom: 14 }}>
            Benutzer hinzufügen
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Suche */}
            <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
              <input
                style={{ ...inp, width: '100%', boxSizing: 'border-box' }}
                placeholder="Name oder E-Mail suchen…"
                value={selUser ? `${selUser.display_name} (${selUser.email})` : search}
                onChange={e => { setSearch(e.target.value); setSelUser(null); setShowDrop(true); }}
                onFocus={() => setShowDrop(true)}
                onBlur={() => setTimeout(() => setShowDrop(false), 150)}
              />
              {showDrop && !selUser && search.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #d4dcd4', borderRadius: 8, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,.1)', marginTop: 2, maxHeight: 240, overflowY: 'auto' }}>
                  {filtered.length === 0 ? (
                    <div style={{ padding: '10px 14px', fontSize: 12.5, color: '#94a394' }}>Kein Benutzer gefunden</div>
                  ) : filtered.map(u => (
                    <div
                      key={u.id}
                      onMouseDown={() => { setSelUser(u); setSearch(''); setShowDrop(false); }}
                      style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid #f0f3f0', display: 'flex', alignItems: 'center', gap: 10 }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f7faf7'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e8f0e8', color: '#4a6a4f', fontWeight: 700, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {initials(u.display_name)}
                      </div>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{u.display_name}</div>
                        <div style={{ fontSize: 11, color: '#94a394' }}>{u.email}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selUser && (
                <button
                  onClick={() => { setSelUser(null); setSearch(''); }}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#94a394', fontSize: 14, lineHeight: 1 }}>
                  ✕
                </button>
              )}
            </div>

            {/* Rolle */}
            <select
              value={selRole}
              onChange={e => setSelRole(e.target.value)}
              style={{ ...inp, cursor: 'pointer', minWidth: 150 }}
            >
              {ROLLEN.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            {/* Button */}
            <button
              onClick={handleAdd}
              disabled={!selUser || adding}
              style={{
                padding: '7px 18px', borderRadius: 8, border: 'none',
                background: selUser ? '#7a9b7f' : '#c5cdc5',
                color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: selUser ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >
              {adding ? 'Fügt hinzu…' : '+ Hinzufügen'}
            </button>
          </div>

          {/* Rollen-Erklärung */}
          <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {ROLLEN.map(r => (
              <div key={r.value} style={{ fontSize: 11.5, color: '#6b826b', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ padding: '1px 7px', borderRadius: 5, background: r.bg, color: r.color, fontWeight: 700, fontSize: 10.5 }}>{r.label}</span>
                {r.desc}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
