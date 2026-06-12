import { Buffer } from "node:buffer";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import mammoth from "npm:mammoth"
import * as XLSX from "https://unpkg.com/xlsx/xlsx.mjs"
import * as pdfjs from "npm:pdfjs-dist@4.0.379"
import MsgReader from "npm:msgreader";
import { docToText } from "npm:doc-to-text";

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
      useSystemFonts: true,
      verbosity: 0
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

async function extractOutlookMsgText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const buffer = new Uint8Array(arrayBuffer);
    const reader = new MsgReader(buffer);
    const fileData = reader.getFileData();

    if (!fileData) {
      throw new Error("Konnte MSG-Inhalt nicht parsen.");
    }

    // Wir extrahieren die wichtigsten Metadaten und den E-Mail-Body
    const sender = fileData.fromName || fileData.senderEmail || "Unbekannt";
    const subject = fileData.subject || "(Kein Betreff)";
    const body = fileData.body || ""; // Enthält den Plain-Text der E-Mail

    let fullText = `[E-Mail von: ${sender}]\n[Betreff: ${subject}]\n[Inhalt]:\n${body}\n`;

    // Optional: Falls du auch die Namen der Anhänge im Text-Index haben willst
    if (fileData.attachments && fileData.attachments.length > 0) {
      fullText += "\n[Anhänge]:\n";
      for (const att of fileData.attachments) {
        fullText += `- ${att.fileName || "Unbekannte Datei"}\n`;
      }
    }

    return fullText;
  } catch (error) {
    console.error("Fehler beim Parsen der Outlook MSG-Datei:", error);
    return "";
  }
}

async function extractOldWordText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);

    // docToText versucht das binäre OLE-Format zu parsen und
    // den Plaintext herauszufiltern
    const text = await docToText(uint8Array);

    return text || "";
  } catch (error) {
    console.error("Fehler beim Parsen der alten Word-Datei (.doc):", error);
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
      if (!extractedText.trim() && false) {
        console.log("⚠️ PDF ist ein Scan (Bild). Starte lokales OCR...");
        const formData = new FormData();
        formData.append("file", new Blob([arrayBuffer]), fileName);

        const ocrResponse = await fetch("http://192.168.5.10:8080/api/v1/ocr/pdf-to-text", {
          method: "POST",
          body: formData
        });

        if (ocrResponse.ok) {
          extractedText = await ocrResponse.text();
          console.log("✅ OCR-Erkennung erfolgreich abgeschlossen!");
        }
      }
    } else if (mimeType.includes("wordprocessingml.document") || filePath.endsWith(".docx")) {
      extractedText = await extractWordText(arrayBuffer);
    } else if (mimeType.includes("spreadsheetml.sheet") || filePath.endsWith(".xlsx")) {
      extractedText = await extractExcelText(arrayBuffer);
    } else if (mimeType === "text/plain") {
      extractedText = new TextDecoder().decode(arrayBuffer);
    } else if (mimeType === "application/vnd.ms-outlook" || filePath.endsWith(".msg")) {
      extractedText = await extractOutlookMsgText(arrayBuffer);
    } else if (mimeType === "application/msword" || filePath.endsWith(".doc")) {
      extractedText = await extractOldWordText(arrayBuffer);
    }

    if (!extractedText.trim()) {
      return new Response(JSON.stringify({ message: "Kein Text gefunden", databaseEntry: false }), { status: 500, headers: corsHeaders });
    }

    // 2. Text-Chunking
    const fileType = mimeType.split('/').pop() || 'unknown';
    const textChunks = chunkTextWithMetadata(extractedText, fileName, fileType, 1500, 200);

    // Schutz vor CPU-Limit-Sprengung (Notbremse)
    if (textChunks.length > 40) {
      console.log(`⚠️ Dokument ist viel zu groß (${textChunks.length} Chunks). Kappe auf die ersten 40 Chunks zum Schutz der Sandbox.`);
      textChunks.length = 40;
    }

    // 3. WORKER-POOL FÜR KONTROLLIERTE EMBEDDING-GENERIERUNG
    const CONCURRENCY_LIMIT = 5;
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

    const workers = Array(CONCURRENCY_LIMIT).fill(null).map(worker);
    await Promise.all(workers);

    // 4. DATENBANK-BATCH-INSERT
    if (validRows.length > 0) {
      const { error: bulkDeleteError } = await supabase
          .from('documents_content')
          .delete()
          .eq('storage_object_id', rec.id);

      if (bulkDeleteError) {
        console.error("Bulk Delete Error:", bulkDeleteError);
      }

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