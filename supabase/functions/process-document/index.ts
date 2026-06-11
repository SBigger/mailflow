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
    // Now 'Buffer' is cleanly defined via the "node:buffer" import above!
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
    // With npm:pdfjs-dist, we pass the Uint8Array directly into the document builder
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false // Disables external network worker requests inside the Edge isolate
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
  textForDatabase: string;    // Der saubere Textabschnitt
  textForEmbedding: string;   // Text + Header (nur für die KI)
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
    // 1. Hole den reinen Text-Chunk
    const rawChunk = text.substring(i, i + chunkSize);

    // 2. Erstelle die Version mit Metadaten für das Embedding-Modell
    const chunkWithContext = `${metadataHeader}${rawChunk}`;

    chunks.push({
      textForDatabase: rawChunk,       // <-- Das speicherst du in `extracted_text`
      textForEmbedding: chunkWithContext // <-- Das schickst du an den Infinity-Server für den Vektor
    });

    i += chunkSize - overlap;
  }
  return chunks;
}

Deno.serve(async (req) => {
  // Always handle CORS preflight first
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }

  try {
    // 1. Parse the top-level body wrapper
    const body = await req.json();

    // 2. Destructure 'rec' out of the body safely
    const { rec } = body;

    if (!rec) {
      throw new Error("Payload key 'rec' was not found in the request body");
    }

    // 3. Initialize your service-role client
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [bucketId, ...rest] = rec.fullPath.split('/');
    const filePath = rest.join('/');
    const fileName = rec.name;

    console.log(`Attempting download - Bucket: ${bucketId}, Path: ${filePath}`);

    const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucketId)
        .download(filePath);

    if (downloadError) {
      console.error("Supabase Storage Download Error:", downloadError);
      throw downloadError;
    }

    if (fileData.size === 0) {
      throw new Error(`The downloaded file from storage is empty (0 bytes). Check if the path '${filePath}' is correct.`);
    }

    const arrayBuffer = await fileData.arrayBuffer();

    // 2. Text extrahieren basierend auf dem Dateityp
    let extractedText = "";
    const mimeType = fileData.type;

    if (mimeType === "application/pdf") {
      extractedText = await extractPdfText(arrayBuffer);
    } else if (mimeType.includes("wordprocessingml.document") || filePath.endsWith(".docx")) {
      extractedText = await extractWordText(arrayBuffer);
    } else if (mimeType.includes("spreadsheetml.sheet") || filePath.endsWith(".xlsx")) {
      extractedText = await extractExcelText(arrayBuffer);
    } else if (mimeType === "text/plain") {
      extractedText = new TextDecoder().decode(arrayBuffer);
    }

    // Falls die Datei leer war, überspringen
    if (!extractedText.trim()) {
      return new Response(JSON.stringify({ message: "Kein Text gefunden" }), { status: 200 })
    }

    // 3. Text chunking
    const fileType = mimeType.split('/').pop() || 'unknown';
    const textChunks = chunkTextWithMetadata(extractedText, fileName, fileType, 1500, 200);

// 1. Promises für alle Chunks parallel starten
    const embeddingPromises = textChunks.map(async (chunkObj) => {
      try {
        const response = await fetch("http://192.168.5.10:7997/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: [chunkObj.textForEmbedding],
            model: "BAAI/bge-small-en-v1.5"
          })
        });

        if (!response.ok) return null;

        const json = await response.json();
        const embedding = json.data[0].embedding;

        return {
          storage_object_id: rec.id,
          file_name: fileName,
          extracted_text: chunkObj.textForDatabase,
          embedding: embedding
        };
      } catch (e) {
        console.error("Error generating embedding for chunk:", e);
        return null;
      }
    });
  
    // 2. ALLE API-Anfragen GLEICHZEITIG auflösen (Nur einmal aufrufen!)
    const completedRows = await Promise.all(embeddingPromises);

    // 3. Fehlgeschlagene Chunks (null) sauber ausfiltern
    const validRows = completedRows.filter(row => row !== null);

    // 4. Datenbank-Aktionen ausführen, wenn wir valide Daten haben
    if (validRows.length > 0) {

      // Erst alte Chunks DIESES EINEN Dokuments löschen, um Duplikate zu vermeiden
      // Wir nutzen direkt rec.id, statt ein künstliches Array aus completedRows zu bauen
      const { error: bulkDeleteError } = await supabase
          .from('documents_content')
          .delete()
          .eq('storage_object_id', rec.id); // .eq() ist sicherer und sauberer als .in() mit Duplikaten

      if (bulkDeleteError) {
        console.error("Bulk Delete Error:", bulkDeleteError);
      }

      // Die neuen, sauberen Chunks gesammelt einfügen
      const { error: insertError } = await supabase
          .from('documents_content')
          .insert(validRows);

      if (insertError) {
        console.error("Bulk Insert Error:", insertError);
        throw insertError;
      }
    }

    return new Response(JSON.stringify({ success: true, chunksProcessed: validRows.length }), { status: 200 })

  } catch (error) {
    console.log("error: ", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})