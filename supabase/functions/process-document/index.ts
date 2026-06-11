import { Buffer } from "node:buffer";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import mammoth from "npm:mammoth"
import * as XLSX from "https://unpkg.com/xlsx/xlsx.mjs"
import * as pdfjs from "npm:pdfjs-dist@4.0.379"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function extractWordText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const nodeBuffer = Buffer.from(arrayBuffer);
    const result = await mammoth.extractRawText({ buffer: nodeBuffer });
    return result.value;
  } catch (error) {
    console.error("Fehler beim Parsen der Word-Datei:", error);
    return "";
  }
}

async function extractExcelText(arrayBuffer: ArrayBuffer): Promise<string> {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  let fullText = "";

  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const sheetText = XLSX.utils.sheet_to_txt(worksheet);
    fullText += `[Sheet: ${sheetName}]\n${sheetText}\n`;
  });

  return fullText;
}

async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      standardFontDataUrl: "https://unpkg.com/pdfjs-dist@4.0.379/standard_fonts/",
      useSystemFonts: true
    });

    const pdf = await loadingTask.promise;
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
          // @ts-ignore
          .map((item) => item.str || "")
          .join(" ");
      fullText += pageText + "\n";
    }

    return fullText;
  } catch (error) {
    console.error("Fehler beim Parsen des PDFs:", error);
    return "";
  }
}

interface ChunkResult {
  textForDatabase: string;
  textForEmbedding: string;
}

function chunkTextWithMetadata(
    text: string,
    fileName: string,
    fileType: string,
    chunkSize = 1500,
    overlap = 200
): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  let i = 0;

  const metadataHeader = `Dokumentenname: ${fileName}\nDateityp: ${fileType}\nInhalt:\n`;

  while (i < text.length) {
    const rawChunk = text.substring(i, i + chunkSize);
    const chunkWithContext = `${metadataHeader}${rawChunk}`;

    chunks.push({
      textForDatabase: rawChunk,
      textForEmbedding: chunkWithContext
    });

    i += chunkSize - overlap;
  }
  return chunks;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { rec } = body;

    if (!rec) {
      throw new Error("Payload key 'rec' was not found in the request body");
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [bucketId, ...rest] = rec.fullPath.split('/');
    const filePath = rest.join('/');
    const fileName = rec.name;

    console.log(`📥 Starte Download - Bucket: ${bucketId}, Path: ${filePath}`);

    const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucketId)
        .download(filePath);

    if (downloadError) {
      console.error("Supabase Storage Download Error:", downloadError);
      throw downloadError;
    }

    if (fileData.size === 0) {
      throw new Error(`Die heruntergeladene Datei ist leer (0 Bytes). Pfad: '${filePath}'`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    let extractedText = "";
    const mimeType = fileData.type;

    // 1. Text-Extraktion basierend auf MimeType
    if (mimeType === "application/pdf") {
      extractedText = await extractPdfText(arrayBuffer);
    } else if (mimeType.includes("wordprocessingml.document") || filePath.endsWith(".docx")) {
      extractedText = await extractWordText(arrayBuffer);
    } else if (mimeType.includes("spreadsheetml.sheet") || filePath.endsWith(".xlsx")) {
      extractedText = await extractExcelText(arrayBuffer);
    } else if (mimeType === "text/plain") {
      extractedText = new TextDecoder().decode(arrayBuffer);
    }

    if (!extractedText.trim()) {
      return new Response(JSON.stringify({ message: "Kein Text gefunden", databaseEntry: false }), { status: 500, headers: corsHeaders });
    }

    // 2. Text-Chunking
    const fileType = mimeType.split('/').pop() || 'unknown';
    const textChunks = chunkTextWithMetadata(extractedText, fileName, fileType, 1500, 200);

    if (textChunks.length > 40) {
      console.log(`⚠️ Dokument ist viel zu groß (${textChunks.length} Chunks). Kappe auf die ersten 40 Chunks zum Schutz der Sandbox.`);
      textChunks.length = 40; // Schneidet das Array hart bei Index 40 ab
    }

    // 3. WORKER-POOL FÜR KONTROLLIERTE EMBEDDING-GENERIERUNG
    const CONCURRENCY_LIMIT = 5; // Maximal 5 parallele Requests an Infinity
    const validRows: any[] = [];
    const chunkQueue = [...textChunks];

    const worker = async () => {
      while (chunkQueue.length > 0) {
        const chunkObj = chunkQueue.shift();
        if (!chunkObj) continue;

        try {
          const response = await fetch("http://192.168.5.10:7997/embeddings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: [chunkObj.textForEmbedding],
              model: "BAAI/bge-small-en-v1.5"
            })
          });

          if (!response.ok) {
            console.error(`❌ Infinity meldete Fehler-Status: ${response.status}`);
            continue;
          }

          const json = await response.json();
          // Hier bricht nichts mehr ab, da wir die Struktur sauber auslesen:
          const embedding = json.data[0].embedding;

          validRows.push({
            storage_object_id: rec.id,
            file_name: fileName,
            extracted_text: chunkObj.textForDatabase,
            embedding: embedding
          });

        } catch (e) {
          console.error(`❌ Netzwerkfehler bei Chunk-Embedding für '${fileName}':`, e.message);
        }
      }
    };

    // Alle Worker gleichzeitig starten (sie teilen sich die queue im Hintergrund)
    const workers = Array(CONCURRENCY_LIMIT).fill(null).map(worker);
    await Promise.all(workers);

    // 4. DATENBANK-BATCH-INSERT
    if (validRows.length > 0) {
      // Lösche alte Chunks dieses spezifischen Dokuments, falls ein Re-Run stattfindet
      const { error: bulkDeleteError } = await supabase
          .from('documents_content')
          .delete()
          .eq('storage_object_id', rec.id);

      if (bulkDeleteError) {
        console.error("Bulk Delete Error:", bulkDeleteError);
      }

      // Alle validen Chunks gesammelt in die DB schreiben
      const { error: insertError } = await supabase
          .from('documents_content')
          .insert(validRows);

      if (insertError) {
        console.error("Bulk Insert Error:", insertError);
        throw insertError;
      }

      console.log(`💾 ${validRows.length} Chunks erfolgreich in 'documents_content' gespeichert.`);
    }

    return new Response(JSON.stringify({ success: true, chunksProcessed: validRows.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("🔴 Kritischer Fehler in der Pipeline:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});