import React, { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';

function storageLocation(value, fallbackBucket) {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    return { bucket: fallbackBucket, path: value.replace(/^\/+/, '') };
  }
  try {
    const decoded = decodeURIComponent(value);
    const match = decoded.match(
      /\/storage\/v1\/object\/(?:public\/|sign\/)?([^/?]+)\/([^?]+)/i,
    );
    if (!match) return null;
    return { bucket: match[1], path: match[2] };
  } catch {
    return null;
  }
}

export default function StorageDocumentLink({
  value,
  bucket = 'expenses',
  className,
  style,
  title = 'Dokument öffnen',
  children,
  onClick,
}) {
  const [busy, setBusy] = useState(false);

  const open = async (event) => {
    event.stopPropagation();
    onClick?.(event);
    const location = storageLocation(value, bucket);
    if (!location) {
      toast.error('Gespeicherter Dokumentpfad ist ungültig.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.storage
        .from(location.bucket)
        .createSignedUrl(location.path, 5 * 60);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error('Dokument konnte nicht geöffnet werden: ' + (error?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className={className}
      style={style}
      title={title}
    >
      {children}
    </button>
  );
}
