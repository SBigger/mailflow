// streamShim.js – Browser-Shim für Node.js `stream`
// ====================================================
// pdfkit/blob-stream importieren `stream` als Bare-Specifier.
// stream-browserify ist CJS und exportiert die Stream-Klasse als module.exports
// mit angehängten Sub-Klassen (Readable, Writable, Transform, …).
// Wir müssen hier sowohl default als auch ALLE Sub-Klassen als Named Exports
// re-exportieren, damit CJS-Code wie `require('stream').Writable` funktioniert.

import Stream from 'stream-browserify';

export default Stream;
export const Readable    = Stream.Readable;
export const Writable    = Stream.Writable;
export const Duplex      = Stream.Duplex;
export const Transform   = Stream.Transform;
export const PassThrough = Stream.PassThrough;
export const finished    = Stream.finished;
export const pipeline    = Stream.pipeline;
export { Stream };
