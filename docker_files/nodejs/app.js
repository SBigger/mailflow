const express = require('express');
const puppeteer = require('puppeteer-core');
const { PassThrough } = require('stream');
const { PDFDocument } = require('pdf-lib');
const PDFKitDocument = require('pdfkit');
const { SwissQRBill } = require('swissqrbill/pdf');

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '15mb' }));

function generateQrBillBuffer(qrData) {
    return new Promise((resolve, reject) => {
        try {
            const stream = new PassThrough();
            const chunks = [];

            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', (err) => reject(err));

            // Hier nutzen wir den umbenannten pdfkit-Import
            const pdf = new PDFKitDocument({ size: 'A4', margin: 0 });
            pdf.pipe(stream);

            const qrBill = new SwissQRBill(qrData);
            qrBill.attachTo(pdf);

            pdf.end();
        } catch (error) {
            reject(error);
        }
    });
}

app.post('/generate-qr-invoice', async (req, res) => {
    const { html, qrData } = req.body;

    if (!html) {
        return res.status(400).json({ error: 'Kein HTML-Inhalt im Body gefunden.' });
    }

    let browser;
    try {
        // --- SCHRITT 1: HTML-Rechnung via Puppeteer rendern ---
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const invoicePdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();

        let finalPdfBuffer = invoicePdfBuffer;

        // --- SCHRITT 2: QR-Bill generieren & mergen, falls Daten übergeben wurden ---
        if (qrData) {
            const qrPdfBuffer = await generateQrBillBuffer(qrData);

            // PDFs mithilfe von pdf-lib zusammenführen
            const mainDoc = await PDFDocument.load(invoicePdfBuffer);
            const qrDoc = await PDFDocument.load(qrPdfBuffer);
            const mergedDoc = await PDFDocument.create();

            // Erste Rechnungsseiten kopieren
            const mainPages = await mergedDoc.copyPages(mainDoc, mainDoc.getPageIndices());
            mainPages.forEach(p => mergedDoc.addPage(p));

            // QR-Rechnungsseite hinten anhängen
            const qrPages = await mergedDoc.copyPages(qrDoc, qrDoc.getPageIndices());
            qrPages.forEach(p => mergedDoc.addPage(p));

            finalPdfBuffer = Buffer.from(await mergedDoc.save());
        }

        // --- SCHRITT 3: Senden ---
        res.contentType("application/pdf");
        res.setHeader('Content-Disposition', 'attachment; filename="rechnung.pdf"');
        res.send(finalPdfBuffer);

    } catch (error) {
        console.error('Fehler:', error);
        res.status(500).json({ error: 'Interner Serverfehler.', details: error.message });
    } finally {
        if (browser && typeof browser.close === 'function') {
            try { await browser.close(); } catch (_) {}
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});