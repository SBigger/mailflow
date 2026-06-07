import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import mammoth from "npm:mammoth"
import * as XLSX from "https://unpkg.com/xlsx/xlsx.mjs"
import { readPdfText } from "https://esm.sh/pdf-text-reader@1.0.1"

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
    // pdf-text-reader accepts the Uint8Array directly and handles page looping under the hood!
    const text = await readPdfText({ data: new Uint8Array(arrayBuffer) });
    return text;
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
  try {
    const { rec } = await req.json()
    console.log("rec:", JSON.stringify(rec));

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

    // 4. Jetzt für jeden Chunk das Embedding generieren und in die DB schreiben
    for (const chunk of textChunks) {
      const response = await fetch("http://infinity:7997/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [chunk],
          model: "gte-small"
        })
      });

      if (!response.ok) {
        console.error(`Embedding service failed with status ${response.status}`);
        continue;
      }

      const json = await response.json();
      const embedding = json.data[0].embedding;

      const { error: insertError } = await supabase
          .from('documents_content')
          .insert({
            storage_object_id: rec.id,
            file_name: fileName,
            extracted_text: chunk,
            embedding: embedding
          });

      if (insertError) {
        console.error("DocId:", rec.id);
        console.error("insertError:", insertError);
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})