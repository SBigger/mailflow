// fontkitStub.js – Browser-Stub für fontkit
// =====================================================================
// pdfkit importiert fontkit für custom font embedding.
// Wir nutzen nur die 14 eingebetteten PDF-Standardfonts (Helvetica etc.)
// → fontkit wird NIE aufgerufen. Dieser Stub verhindert, dass fontkit
//   mit seinen CJS-Deps (unicode-trie, brotli, restructure, …) geladen
//   wird und den Vite-Renderer einfriert.

const fontkit = {
  openSync: () => { throw new Error('fontkit: Custom-Fonts werden im Browser nicht unterstützt.'); },
  open: () => Promise.reject(new Error('fontkit: Custom-Fonts werden im Browser nicht unterstützt.')),
  create: () => { throw new Error('fontkit: Custom-Fonts werden im Browser nicht unterstützt.'); },
};

export default fontkit;
