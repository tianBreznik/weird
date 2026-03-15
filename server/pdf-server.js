import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
const PORT = process.env.PDF_SERVER_PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';

// Basic CORS so the frontend can call this directly or via Vite proxy
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/generate-pdf', async (req, res) => {
  let browser = null;
  let page = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    page = await browser.newPage();
    const url = `${FRONTEND_URL}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

    // Wait until DesktopPageReader has attached the generator
    await page.waitForFunction('window.__generatePdfFromViewer != null', {
      timeout: 120000,
    });

    const pdfBase64 = await page.evaluate(async () => {
      if (typeof window === 'undefined' || !window.__generatePdfFromViewer) return null;
      return window.__generatePdfFromViewer();
    });

    if (!pdfBase64) {
      return res.status(500).json({ error: 'PDF generation failed (no data returned)' });
    }

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=\"weird-attachments-server.pdf\"');
    res.send(pdfBuffer);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Server html2canvas+jsPDF failed:', err);
    res.status(500).json({ error: 'PDF generation failed', details: err.message });
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`PDF server listening on http://localhost:${PORT} (frontend: ${FRONTEND_URL})`);
});

