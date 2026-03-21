import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// ENTITIES API - Drop-in Replacement für Base44
// entities.X.filter() → entities.X.filter()
// ============================================

function makeEntity(tableName) {
  return {
    // Real-time subscription to table changes
    subscribe(callback) {
      const channel = supabase
        .channel(`realtime-${tableName}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, (payload) => {
          callback({ type: payload.eventType, data: payload.new || payload.old });
        })
        .subscribe();
      return () => supabase.removeChannel(channel);
    },

    async list(orderBy = 'created_at', limit = 1000) {
      let query = supabase.from(tableName).select('*');
      if (orderBy) query = query.order(orderBy.replace(/^-/, ''), { ascending: !orderBy.startsWith('-') });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data || [];
    },

    async filter(filters = {}, orderBy = 'created_at', limit = 1000, offset = 0) {
      let query = supabase.from(tableName).select('*');
      for (const [key, val] of Object.entries(filters)) {
        if (val !== undefined && val !== null) query = query.eq(key, val);
      }
      if (orderBy) query = query.order(orderBy.replace(/^-/, ''), { ascending: !orderBy.startsWith('-') });
      if (limit) query = query.limit(limit);
      if (offset) query = query.range(offset, offset + limit - 1);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data || [];
    },

    async get(id) {
      const { data, error } = await supabase.from(tableName).select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      return data;
    },

    async create(payload) {
      const { data: { user } } = await supabase.auth.getUser();
      const row = { ...payload, created_by: user?.id };
      const { data, error } = await supabase.from(tableName).insert(row).select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    async update(id, payload) {
      const { data, error } = await supabase.from(tableName).update(payload).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    async delete(id) {
      const { error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) throw new Error(error.message);
      return true;
    },

    async bulkCreate(items) {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = items.map(item => ({ ...item, created_by: item.created_by || user?.id }));
      const { data, error } = await supabase.from(tableName).insert(rows).select();
      if (error) throw new Error(error.message);
      return data;
    }
  };
}

// Alle Entities
export const entities = {
  MailItem:         makeEntity('mail_items'),
  KanbanColumn:     makeEntity('kanban_columns'),
  MailKanbanMapping: makeEntity('mail_kanban_mappings'),
  Task:             makeEntity('tasks'),
  TaskColumn:       makeEntity('task_columns'),
  Customer:         makeEntity('customers'),
  Tag:              makeEntity('tags'),
  Project:          makeEntity('projects'),
  DomainTagRule:    makeEntity('domain_tag_rules'),
  Priority:         makeEntity('priorities'),
  User:             makeEntity('profiles'),
  TaskReadStatus:   makeEntity('task_read_statuses'),
  Staff:            makeEntity('staff'),
  ActivityTemplate: makeEntity('activity_templates'),
  Frist:            makeEntity('fristen'),
  Ticket:           makeEntity('support_tickets'),
  TicketMessage:    makeEntity('ticket_messages'),
  TicketColumn:     makeEntity('ticket_columns'),
  KnowledgeBase:    makeEntity('knowledge_base'),
  Dokument:         makeEntity('dokumente'),
  DokTag:           makeEntity('dok_tags'),
  BriefVorlage:     makeEntity('brief_vorlagen'),
  Fahrzeug:         makeEntity('fahrzeuge'),
  Aktienbuch:       makeEntity('aktienbuch'),
  Signatur:         makeEntity('signaturen'),
};

// Auth helpers
export const auth = {
  async me() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (!data) return null;
    // Ensure email is always set – some profiles created via DB trigger may have null email
    if (!data.email && user.email) {
      // Patch the profile silently so future calls and task filters work
      await supabase.from('profiles').update({ email: user.email }).eq('id', user.id);
      return { ...data, email: user.email };
    }
    return data;
  },

  async updateMe(payload) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('profiles').update(payload).eq('id', user.id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  },

  async logout() {
    await supabase.auth.signOut();
  },

  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  }
};

// ─── File Upload via Supabase Storage ────────────────────────────────────────
// Lädt eine Datei in den 'dokumente'-Bucket hoch und gibt die öffentliche URL zurück.
export async function uploadFile(file, folder = 'task-attachments') {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from('dokumente').upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  const { data: { publicUrl } } = supabase.storage.from('dokumente').getPublicUrl(path);
  return publicUrl;
}

// Functions - werden Supabase Edge Functions
export const functions = {
  async invoke(name, payload = {}) {
    const { data, error } = await supabase.functions.invoke(name, { body: payload });
    if (error) throw new Error(error.message);
    return { data };
  }
};
