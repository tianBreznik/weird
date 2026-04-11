/* eslint-env node */
import express from 'express';
import puppeteer from 'puppeteer';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';

const app = express();
const PORT = process.env.PDF_SERVER_PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';

app.use(express.json({ limit: '1mb' }));

function getMonthKey(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function initFirebaseAdmin() {
  if (admin.apps?.length) return admin.app();

  // Prefer explicit service account JSON (best for serverless/container deploys)
  const saJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    '';
  const parsed = saJson ? safeJsonParse(saJson) : null;

  if (parsed) {
    return admin.initializeApp({
      credential: admin.credential.cert(parsed),
      projectId:
        process.env.FIREBASE_PROJECT_ID ||
        process.env.VITE_FIREBASE_PROJECT_ID ||
        parsed.project_id,
    });
  }

  // Fallback: Application Default Credentials (works locally if configured)
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  });
}

async function getAllowedEmails(db) {
  const snap = await db.collection('allowedEmails').get();
  return snap.docs.map((d) => d.id).filter(Boolean);
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

// Basic CORS so the frontend can call this directly or via Vite proxy
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/api/pdf-download', async (req, res) => {
  const {
    bookId = null,
    pdfVersion = null,
    contentVersion = null,
    filename = 'weird-attachments.pdf',
    source = null, // 'cached' | 'generated' | 'server' | null
  } = req.body || {};

  const now = new Date();
  const monthKey = getMonthKey(now);

  let monthCount = null;
  let monthStats = null;
  let owners = [];
  let db = null;

  try {
    initFirebaseAdmin();
    db = admin.firestore();
    owners = await getAllowedEmails(db);
    if (owners.length === 0) {
      return res.json({
        ok: true,
        skipped: 'no allowedEmails found',
      });
    }

    const event = {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      monthKey,
      bookId,
      filename,
      source,
      pdfVersion,
      contentVersion,
      userAgent: req.get('user-agent') || null,
      referer: req.get('referer') || null,
      ip:
        (req.headers['x-forwarded-for'] && String(req.headers['x-forwarded-for']).split(',')[0].trim()) ||
        req.ip ||
        null,
    };

    await db.collection('pdfDownloads').add(event);

    const monthRef = db.collection('pdfDownloadStatsByMonth').doc(monthKey);
    monthCount = await db.runTransaction(async (tx) => {
      const snap = await tx.get(monthRef);
      const next = (snap.exists ? (snap.data()?.count || 0) : 0) + 1;
      tx.set(
        monthRef,
        {
          monthKey,
          count: next,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return next;
    });

    // Pull last 12 months (lexicographic order works for YYYY-MM)
    const statsSnap = await db
      .collection('pdfDownloadStatsByMonth')
      .orderBy('monthKey', 'desc')
      .limit(12)
      .get();
    monthStats = statsSnap.docs
      .map((d) => ({ monthKey: d.id, count: d.data()?.count || 0 }))
      .reverse();
  } catch (err) {
    console.error('[pdf-download] Firestore logging failed:', err);
  }

  const transporter = createTransporter();
  if (!transporter) {
    return res.json({
      ok: true,
      warned: 'SMTP not configured; recorded download (if Firestore configured)',
      monthKey,
      monthCount,
      monthStats,
    });
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = `PDF downloaded (${monthKey}: ${monthCount ?? 'n/a'} so far)`;

  const lines = [
    'A PDF was downloaded.',
    '',
    `Time (UTC): ${now.toISOString()}`,
    `Book ID: ${bookId ?? '(none)'}`,
    `Filename: ${filename}`,
    `Source: ${source ?? '(unknown)'}`,
    `PDF version: ${pdfVersion ?? '(unknown)'}`,
    `Content version: ${contentVersion ?? '(unknown)'}`,
    '',
    `Month-to-date (${monthKey}): ${monthCount ?? '(unknown)'}`,
    '',
    'Downloads by month:',
  ];

  if (Array.isArray(monthStats) && monthStats.length > 0) {
    monthStats.forEach((m) => lines.push(`- ${m.monthKey}: ${m.count}`));
  } else {
    lines.push('- (no stats available)');
  }

  try {
    await transporter.sendMail({
      from,
      to: owners,
      subject,
      text: lines.join('\n'),
    });
  } catch (err) {
    console.error('[pdf-download] Email send failed:', err);
    return res.status(500).json({ ok: false, error: 'email_failed', details: err.message });
  }

  return res.json({ ok: true, monthKey, monthCount, monthStats });
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
    res.setHeader('Content-Disposition', 'attachment; filename="weird-attachments-server.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Server html2canvas+jsPDF failed:', err);
    res.status(500).json({ error: 'PDF generation failed', details: err.message });
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`PDF server listening on http://localhost:${PORT} (frontend: ${FRONTEND_URL})`);
});

