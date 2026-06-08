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
    console.log("Raw Incoming Body:", JSON.stringify(body));

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
    const fileName = rest[rest.length - 1];

    console.log(`Attempting download - Bucket: ${bucketId}, Path: ${filePath}`);

    const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucketId)
        .download(filePath);

    if (downloadError) {
      console.error("Supabase Storage Download Error:", downloadError);
      throw downloadError;
    }

    // CRITICAL DEBUG LOGS: Check the size of the file downloaded
    console.log(`Download successful! MimeType: ${fileData.type}, Size: ${fileData.size} bytes`);

    if (fileData.size === 0) {
      throw new Error(`The downloaded file from storage is empty (0 bytes). Check if the path '${filePath}' is correct.`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    console.log(`ArrayBuffer byteLength: ${arrayBuffer.byteLength}`);

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
    const textChunks = chunkText(extractedText, 1500, 200);

    console.log(`Processing ${textChunks.length} chunks in parallel...`);

    // 4. Map chunks into an array of embedding promises to run them simultaneously
    const embeddingPromises = textChunks.map(async (chunk) => {
      try {
        const response = await fetch("http://192.168.5.10:7997/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: [chunk],
            model: "BAAI/bge-small-en-v1.5"
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
    console.log("error: ", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})