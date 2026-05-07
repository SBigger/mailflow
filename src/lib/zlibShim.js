// zlibShim.js – Browser-Shim für Node.js `zlib`
// ================================================
// pdfkit nutzt `zlib.createDeflate()` u.a. Named Exports.
// browserify-zlib ist CJS mit `exports.createDeflate = ...` – kein default.
// Wir re-exportieren hier alle relevanten Named Exports für CJS-Interop.

import * as zlibModule from 'browserify-zlib';

const zlib = zlibModule.default || zlibModule;

export default zlib;
export const Deflate         = zlib.Deflate;
export const Inflate         = zlib.Inflate;
export const Gzip            = zlib.Gzip;
export const Gunzip          = zlib.Gunzip;
export const DeflateRaw      = zlib.DeflateRaw;
export const InflateRaw      = zlib.InflateRaw;
export const Unzip           = zlib.Unzip;
export const createDeflate   = zlib.createDeflate;
export const createInflate   = zlib.createInflate;
export const createDeflateRaw = zlib.createDeflateRaw;
export const createInflateRaw = zlib.createInflateRaw;
export const createGzip      = zlib.createGzip;
export const createGunzip    = zlib.createGunzip;
export const createUnzip     = zlib.createUnzip;
export const deflate         = zlib.deflate;
export const deflateSync     = zlib.deflateSync;
export const inflate         = zlib.inflate;
export const inflateSync     = zlib.inflateSync;
export const gzip            = zlib.gzip;
export const gzipSync        = zlib.gzipSync;
export const gunzip          = zlib.gunzip;
export const gunzipSync      = zlib.gunzipSync;
export const deflateRaw      = zlib.deflateRaw;
export const deflateRawSync  = zlib.deflateRawSync;
export const inflateRaw      = zlib.inflateRaw;
export const inflateRawSync  = zlib.inflateRawSync;
export const unzip           = zlib.unzip;
export const unzipSync       = zlib.unzipSync;
