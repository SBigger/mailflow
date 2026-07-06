import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Setup CORS headers so your frontend can call this function
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    try {
        const { belegId, template, mandatenId } = await req.json();

        let beleg = null;
        if (belegId !== 'dummy') {
            const { data, error } = await supabase
                .from('fibu_debitoren_belege')
                .select(`*,
                fibu_debitoren_positionen (*),
                fibu_mandanten (*),
                fibu_kunden (*)`)
                .eq('id', belegId) // Filters the parent document by its ID
                .single();

            if (error) {
                console.log(error.message);
                throw error;
            }

            beleg = data;
            console.log("mandatenId", mandatenId);
            const { data: zahlstelle, err } = await supabase
                .from('fibu_zahlstellen')
                .select('*')
                .eq('mandant_id', mandatenId)
                .order('ist_standard', { ascending: false })
                .order('sortierung')
                .order('bezeichnung')
                .single();

            if (error) {
                console.log(error.message);
                throw error;
            }

            console.log("zahlstelle: ",JSON.stringify(zahlstelle));

            beleg.zahlstelle = zahlstelle;

        } else {
            const { data: mandant, error } = await supabase
                .from('fibu_mandanten')
                .select(`*`)
                .eq('id', mandatenId) // Filters the parent document by its ID
                .single();
            beleg = createDummy(mandant)
            console.log("beleg", JSON.stringify(beleg));
        }

        let htmlContent = await getTemplate(template, supabase)
        const html = renderTemplate(htmlContent, beleg)
        const qrData = createQrData(beleg)

        console.log(JSON.stringify(qrData));


        const pdfResponse = await fetch('http://192.168.5.10:3000/generate-qr-invoice', {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                html: html,
                qrData: qrData
            }),
        });

        if (!pdfResponse.ok) {
            const errorText = await pdfResponse.text();
            throw new Error(`PDF-Container Fehler: ${errorText}`);
        }

        // 3. Die Binärdaten (PDF) aus dem Response-Stream lesen
        const pdfBuffer = await pdfResponse.arrayBuffer();

        return new Response(pdfBuffer, {
            headers: {
                ...corsHeaders,
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="Rechnung_${beleg.beleg_nr || 'Preview'}.pdf"`,
            },
            status: 200,
        });

    } catch (error: any) {
        console.log(error);
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400
            }
        )
    }
})

function createDummy(mandant: any) {
    const beleg = {
        id: 'preview',
        beleg_nr: 'MUSTER',
        titel: 'Beratung & Material (Vorschau)',
        belegdatum: new Date().toISOString().slice(0, 10),
        faelligkeit: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
        waehrung: 'CHF',
        betrag_netto: 1405,
        betrag_mwst: 113.81,
        betrag_brutto: 1518.81,
        zahlungsreferenz: buildQrReference('1001', 'MUSTER2026'),
        fibu_debitoren_positionen: [
            {bezeichnung: 'Beratung Buchhaltung', menge: 8, einheit: 'Std', einzelpreis: 140, betrag_brutto: 1210.72},
            {bezeichnung: 'Ordner & Register (Set)', menge: 10, einheit: 'Stk', einzelpreis: 28.5, betrag_brutto: 308.09},
        ],
        fibu_kunden: {
            name: 'Muster Kunde AG', nr: 'K-1001', adresse: 'Beispielweg 12', plz: '8000', ort: 'Zürich', land: 'CH'
        },
        fibu_mandanten: {
            ...mandant,
            name: mandant.name || 'Muster Treuhand AG',
            adresse: mandant.adresse || 'Musterstrasse 1', plz: mandant.plz || '8000', ort: mandant.ort || 'Zürich'
        },
        zahlstelle: { qr_iban: 'CH2830000011623852950' }
    }

    return beleg
}

async function getTemplate(template: string, supabase: any): Promise<string> {
    // 'templates' is your bucket name, templatePath is the file path (e.g., 'invoice_v1.html')
    const { data, error } = await supabase.storage
        .from('fibu-invoice-templates')
        .download(`${template}.html`)

    if (error) {
        console.log(error);
        throw new Error(`Failed to download template: ${error.message}`)
    }

    // Convert the Blob/File data into a standard string
    const htmlTemplate = await data.text()
    return htmlTemplate;
}

function renderTemplate(html: string, beleg: any) {
    // 1. Positionen wie gehabt mappen
    const positionenHtml = beleg.fibu_debitoren_positionen.map((pos: any, index: number) => {
        // Im neuen Template nutzt die kompakte/klassische Ansicht "zebra-row" statt "zebra"
        const rowClass = index % 2 === 0 ? ' class="zebra-row"' : ''

        return `<tr${rowClass}>
      <td class="col-pos">${index + 1}</td>
      <td class="col-bez">${pos.bezeichnung || ''}</td>
      <td class="col-menge">${Number(pos.menge).toFixed(2)}</td>
      <td class="col-eh">${pos.einheit || 'Stk'}</td>
      <td class="col-preis">${Number(pos.einzelpreis).toFixed(2)}</td>
      <td class="col-betrag">${Number(pos.betrag_brutto).toFixed(2)}</td>
    </tr>`.trim()
    }).join('\n      ')

    // 2. Absenderzeilen vorbereiten (Logik aus deinem PDF-Code extrahiert)
    const mandant = beleg.fibu_mandanten || {}
    const absLines = String(mandant.rechnung_absender || '').split('\n').filter(Boolean)
    const fallback = [mandant.name, mandant.adresse, [mandant.plz, mandant.ort].filter(Boolean).join(' ')].filter(Boolean)
    const lines = absLines.length ? absLines : fallback

    const mandantLinesInline = lines.slice(1).join(' · ') // Für Modern & Kompakt (Strasse · PLZ Ort)
    const mandantLinesNewline = lines.join('\n')          // Für Klassisch

    // 3. Kunden-Objekt für einfacheres Handling
    const kunde = beleg.fibu_kunden || {}

    return html
        // Branding & Logo
        .replace('{{logo_url}}', mandant.rechnung_logo_url || '')
        .replace('{{mandant_name}}', mandant.name || '')
        .replace('{{mandant_lines_inline}}', mandantLinesInline)
        .replace('{{mandant_lines_newline}}', mandantLinesNewline)

        // Rechnungsempfänger (Kunde)
        .replace('{{kunde_name}}', kunde.name || 'Unbekannter Kunde')
        .replace('{{kunde_adresse}}', kunde.adresse || '')
        .replace('{{kunde_plz}}', kunde.plz || '')
        .replace('{{kunde_ort}}', kunde.ort || '')

        // Rechnungs-Meta & Sichtbarkeits-Flags
        .replace('{{beleg_nr}}', beleg.beleg_nr || '')
        .replace('{{belegdatum}}', beleg.belegdatum ? beleg.belegdatum.slice(0, 10) : '')
        .replace('{{faelligkeit}}', beleg.faelligkeit ? beleg.faelligkeit.slice(0, 10) : '')
        .replace('{{kunde_nr}}', kunde.nr || '')
        .replace('{{show_kunde_nr}}', kunde.nr ? '' : 'display: none;')

        // Optionaler Beleg-Titel
        .replace('{{beleg_titel}}', beleg.titel || '')
        .replace('{{show_beleg_titel}}', beleg.titel ? '' : 'display: none;')

        // Positionen & Finanzen
        .replace('{{positionen_rows}}', positionenHtml)
        .replace('{{betrag_netto}}', Number(beleg.betrag_netto || 0).toFixed(2))
        .replace('{{betrag_mwst}}', Number(beleg.betrag_mwst || 0).toFixed(2))
        .replace('{{betrag_brutto}}', Number(beleg.betrag_brutto || 0).toFixed(2))

        // Fusszeile
        .replace('{{mandant_fusszeile}}', mandant.rechnung_fusszeile || '')
        .replace('{{show_fusszeile}}', mandant.rechnung_fusszeile ? '' : 'display: none;')
}

function createQrData(beleg: any) {
    const account = normIban(beleg.zahlstelle.qr_iban || beleg.zahlstelle.iban || '');
    const isQr = isQrIban(account);
    const ref = String(beleg.zahlungsreferenz || '').replace(/\s+/g, '');
    const hasValidQrRef = /^[0-9]{27}$/.test(ref);
    // QR-IBAN verlangt zwingend eine gueltige 27-stellige QR-Referenz. Fehlt sie,
    // klar abbrechen (frueher wurde still eine Dummy-Referenz gesetzt -> ungueltiger,
    // rechtlich falscher Zahlteil auf produktiven Rechnungen).
    if (isQr && !hasValidQrRef) {
        throw new Error(`QR-Rechnung ${beleg.beleg_nr || ''}: QR-IBAN erfordert eine gueltige 27-stellige QR-Referenz, es ist aber keine hinterlegt. Bitte Referenz erfassen oder eine normale IBAN verwenden.`);
    }
    const mAddr = splitAddr(beleg.fibu_mandanten.adresse);
    return {
        currency: beleg.waehrung || 'CHF',
        amount: Number(beleg.betrag_brutto || 0),
        // Normale IBAN -> KEINE Referenz (Typ NON); QR-IBAN -> die gueltige QR-Referenz.
        reference: isQr ? ref : undefined,
        message: `Rechnung ${beleg.beleg_nr || ''}`.trim(),
        creditor: {
            name: beleg.fibu_mandanten.name || 'Firma',
            account: account,
            address: mAddr.street, buildingNumber: mAddr.nr,
            zip: beleg.fibu_mandanten.plz || '', city: beleg.fibu_mandanten.ort || '', country: 'CH',
        },
        debtor: (beleg.fibu_kunden?.name && beleg.fibu_kunden?.ort) ? {
            name: beleg.fibu_kunden.name,
            address: splitAddr(beleg.fibu_kunden.adresse).street, buildingNumber: splitAddr(beleg.fibu_kunden.adresse).nr,
            zip: beleg.fibu_kunden.plz || '', city: beleg.fibu_kunden.ort || '', country: beleg.fibu_kunden.land || 'CH',
        } : undefined,
    };
}

const splitAddr = (adresse) => {
    const s = String(adresse || '').trim();
    const m = s.match(/^(.*?)(\s+\d+\s*[a-zA-Z]?)$/);
    return m ? { street: m[1].trim(), nr: m[2].trim() } : { street: s, nr: '' };
};

function buildQrReference(customerNo: string, invoiceNo: string): string {
    // Simple representation - adjust to match your Swiss QR-bill standard logic
    return `21000000000${customerNo}${invoiceNo}`.padEnd(27, '0');
}

// ── IBAN normalisieren (Leerzeichen entfernen, Grossbuchstaben) ──
export function normIban(iban) {
    return String(iban || '').replace(/\s+/g, '').toUpperCase();
}

// ── QR-IBAN-Erkennung: IID (Stellen 5–9) im Bereich 30000–31999 ──
export function isQrIban(iban) {
    const n = normIban(iban);
    if (!/^CH|^LI/.test(n) || n.length < 9) return false;
    const iid = parseInt(n.slice(4, 9), 10);
    return iid >= 30000 && iid <= 31999;
}