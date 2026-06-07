import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import mammoth from "npm:mammoth"
import * as XLSX from "https://unpkg.com/xlsx/xlsx.mjs"
import { PDFDocument } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"

async function extractWordText(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
  return result.value;
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
    // Load the PDF via pure JS pdf-lib
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    let fullText = "";

    // Iterate through pages and attempt basic text mapping
    // Note: pdf-lib reads structural data cleanly without native canvas rendering engines!
    for (const page of pages) {
      // Get the raw content stream tokens if available
      const stream = page.node.getContentStream();
      if (stream) {
        fullText += stream.toString() + "\n";
      }
    }

    // If stream reading is encrypted/complex, fallback or return structure
    return fullText || "PDF Structure Parsed (No raw stream text)";
  } catch (error) {
    console.error("Fehler beim Parsen des PDFs:", error);
    return "";
  }
}

function chunkText(text: string, chunkSize = 1500, overlap = 200): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.substring(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

Deno.serve(async (req) => {
  console.log("👉 Function process-document triggered!");

  try {
    // Check if the request body is empty before parsing JSON
    const contentType = req.headers.get("content-type");
    if (!req.body || !contentType || !contentType.includes("application/json")) {
      throw new Error("Missing or invalid JSON body in request");
    }

    const body = await req.json();
    console.log("Raw Incoming Body:", JSON.stringify(body));

    const { rec } = body;
    if (!rec) {
      throw new Error("Payload key 'rec' was not found in the request body");
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const [bucketId, ...rest] = rec.fullPath.split('/');
    const filePath = rest.join('/');
    const fileName = rest[rest.length - 1];

    // 1. Datei aus dem Storage laden
    const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucketId)
        .download(filePath)

    if (downloadError) throw downloadError

    const arrayBuffer = await fileData.arrayBuffer();

    // 2. Text extrahieren basierend auf dem Dateityp
    let extractedText = ""
    const mimeType = fileData.type;

    if (mimeType === "application/pdf") {
      extractedText = await extractPdfText(arrayBuffer);
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      extractedText = await extractWordText(arrayBuffer);
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      extractedText = await extractExcelText(arrayBuffer);
    } else if (mimeType === "text/plain") {
      extractedText = new TextDecoder().decode(arrayBuffer);
    }

    // Falls die Datei leer war, überspringen
    if (!extractedText.trim()) {
      return new Response(JSON.stringify({ message: "Kein Text gefunden" }), { status: 200 })
    }

    // 3. Text chunking
    const textChunks = chunkText(extractedText, 1500, 200);

    console.log(`Processing ${textChunks.length} chunks in parallel...`);

    // 4. Map chunks into an array of embedding promises to run them simultaneously
    const embeddingPromises = textChunks.map(async (chunk) => {
      try {
        const response = await fetch("http://infinity:7997/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: [chunk],
            model: "gte-small"
          })
        });

        if (!response.ok) return null;

        const json = await response.json();
        const embedding = json.data[0].embedding;

        // Return the constructed database row object
        return {
          storage_object_id: rec.id,
          file_name: fileName,
          extracted_text: chunk,
          embedding: embedding
        };
      } catch (e) {
        console.error("Error generating embedding for chunk:", e);
        return null;
      }
    });

    // Fire off ALL embedding API requests at the exact same time
    const completedRows = await Promise.all(embeddingPromises);

    // Filter out any chunks that failed to get an embedding
    const validRows = completedRows.filter(row => row !== null);

    // 5. Bulk insert everything into Supabase in a single database round-trip!
    if (validRows.length > 0) {
      const { error: insertError } = await supabase
          .from('documents_content')
          .insert(validRows); // Passing the array inserts everything at once

      if (insertError) {
        console.error("Bulk Insert Error:", insertError);
        throw insertError;
      }
    }

    return new Response(JSON.stringify({ success: true, chunksProcessed: validRows.length }), { status: 200 })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})