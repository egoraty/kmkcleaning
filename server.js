const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(ROOT, 'data');
const CONSENT_LOG_PATH = path.join(DATA_DIR, 'consent-log.jsonl');
const REQUEST_LOG_PATH = path.join(DATA_DIR, 'requests.jsonl');
const CONSENT_SECRET = process.env.CONSENT_LOG_SECRET || 'KMK_LOCAL_DEV_SECRET_CHANGE_BEFORE_PRODUCTION';

const COMPANY = {
  name: 'КМК',
  subtitle: 'Cleaning Experts',
  site: 'kmk-cleaning.ru',
  phone: '+7 (812) 327-26-83',
  email: 'mail@kmk.spb.ru',
  address: 'Санкт-Петербург, ул. Оружейника Фёдорова, 7',
  secondAddress: 'Санкт-Петербург, ул. Комсомола, 1-3 АУ',
  since: 'Профессиональный клининг в Санкт-Петербурге с 1991 года'
};

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function safe(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
}

function logoDataUri() {
  const logoPath = path.join(ROOT, 'assets', 'logo', 'mainicon.png');
  const logo = fs.readFileSync(logoPath).toString('base64');
  return `data:image/png;base64,${logo}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body is too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || '';
}

function hashIp(ip) {
  return crypto.createHmac('sha256', CONSENT_SECRET).update(ip).digest('hex');
}

function appendJsonLine(filePath, entry) {
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function cleanPhoneDigits(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

function createConsentEntry(req, payload) {
  return {
    consent_uuid: crypto.randomUUID(),
    created_at_utc: new Date().toISOString(),
    consent_type: String(payload.consentType || 'unknown'),
    form_id: String(payload.formId || 'unknown'),
    page_url: String(payload.pageUrl || ''),
    document_version: String(payload.documentVersion || ''),
    document_url: String(payload.documentUrl || ''),
    accepted: Boolean(payload.accepted),
    marketing_accepted: Boolean(payload.marketingAccepted),
    offer_accepted: Boolean(payload.offerAccepted),
    cookie_categories: payload.cookieCategories || null,
    ip_hash: hashIp(getClientIp(req)),
    user_agent: String(req.headers['user-agent'] || ''),
    request_reference: String(payload.requestReference || ''),
    metadata_json: payload.metadata || null
  };
}

function handleConsentLog(req, res, payload) {
  if (!payload || payload.accepted !== true) {
    sendJson(res, 422, { error: 'Consent is required' });
    return;
  }

  appendJsonLine(CONSENT_LOG_PATH, createConsentEntry(req, payload));
  sendJson(res, 200, { ok: true });
}

function handleCallback(req, res, payload) {
  if (!payload || payload.personalDataConsent !== true) {
    sendJson(res, 422, { error: 'Personal data consent is required' });
    return;
  }

  const digits = cleanPhoneDigits(payload.phone);
  if (digits.length !== 10) {
    sendJson(res, 422, { error: 'Valid phone is required' });
    return;
  }

  const requestReference = crypto.randomUUID();
  appendJsonLine(REQUEST_LOG_PATH, {
    request_reference: requestReference,
    created_at_utc: new Date().toISOString(),
    type: 'callback',
    phone: `+7${digits}`,
    page_url: String(payload.pageUrl || ''),
    user_agent: String(req.headers['user-agent'] || '')
  });
  appendJsonLine(CONSENT_LOG_PATH, createConsentEntry(req, {
    consentType: 'personal_data',
    formId: 'footer_callback',
    pageUrl: payload.pageUrl,
    documentVersion: payload.documentVersion,
    documentUrl: '/personal-data-consent/',
    accepted: true,
    requestReference,
    metadata: { source: 'footer_callback' }
  }));

  sendJson(res, 200, { ok: true, requestReference });
}

function handleOrder(req, res, payload) {
  if (!payload || payload.personalDataConsent !== true || payload.offerAccepted !== true) {
    sendJson(res, 422, { error: 'Required consent is missing' });
    return;
  }

  const digits = cleanPhoneDigits(payload.phone);
  if (digits.length !== 10) {
    sendJson(res, 422, { error: 'Valid phone is required' });
    return;
  }

  const requestReference = crypto.randomUUID();
  appendJsonLine(REQUEST_LOG_PATH, {
    request_reference: requestReference,
    created_at_utc: new Date().toISOString(),
    type: 'order',
    estimate: {
      propertyType: payload.propertyType,
      area: payload.area,
      rooms: payload.rooms,
      cleaningType: payload.cleaningType,
      services: payload.services,
      date: payload.date,
      time: payload.time,
      total: payload.total,
      promoCode: payload.promoCode || ''
    },
    contact: {
      name: payload.name,
      phone: payload.phone,
      address: payload.address,
      comment: payload.comment || ''
    },
    marketing_accepted: Boolean(payload.marketingAccepted),
    page_url: String(payload.pageUrl || ''),
    user_agent: String(req.headers['user-agent'] || '')
  });

  appendJsonLine(CONSENT_LOG_PATH, createConsentEntry(req, {
    consentType: 'public_offer',
    formId: 'calculator_order',
    pageUrl: payload.pageUrl,
    documentVersion: payload.documentVersion,
    documentUrl: '/public-offer/',
    accepted: true,
    offerAccepted: true,
    marketingAccepted: Boolean(payload.marketingAccepted),
    requestReference
  }));

  sendJson(res, 200, { ok: true, requestReference });
}

function renderEstimateHtml(data) {
  const logo = logoDataUri();
  const services = Array.isArray(data.services) ? data.services : [];
  const serviceRows = services.length
    ? services.map(item => `
        <div class="line-item">
          <span>${safe(item.name)}</span>
          <strong>${money(item.price)}</strong>
        </div>
      `).join('')
    : '<div class="muted-box">Дополнительные услуги не выбраны</div>';

  return `<!doctype html>
  <html lang="ru">
  <head>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #101a33;
        background: #edf4fc;
        font-family: Arial, Helvetica, sans-serif;
      }
      .page {
        width: 794px;
        min-height: 1123px;
        padding: 34px 38px;
        background:
          radial-gradient(circle at 92% 8%, rgba(21,117,255,0.14), transparent 260px),
          linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 18px 20px;
        border: 1px solid #dfe9f6;
        border-radius: 22px;
        background: rgba(255,255,255,0.9);
        box-shadow: 0 12px 28px rgba(35, 72, 122, 0.08);
      }
      .brand-wrap {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .logo {
        width: 118px;
        height: auto;
        display: block;
      }
      .brand-title {
        color: #101a33;
        font-size: 18px;
        line-height: 1.25;
        font-weight: 800;
      }
      .brand-subtitle {
        margin-top: 4px;
        color: #65768f;
        font-size: 12px;
        font-weight: 600;
      }
      .doc-meta {
        text-align: right;
        color: #536783;
        font-size: 12px;
        line-height: 1.55;
      }
      .doc-meta strong {
        display: block;
        color: #1575ff;
        font-size: 15px;
        margin-bottom: 3px;
      }
      h1 {
        margin: 28px 0 8px;
        color: #101a33;
        font-size: 30px;
        line-height: 1.2;
        letter-spacing: -0.3px;
      }
      .lead {
        margin: 0 0 22px;
        color: #5d6d86;
        font-size: 14px;
        line-height: 1.45;
      }
      .contact-strip {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin: 0 0 18px;
      }
      .contact-card {
        padding: 12px 14px;
        border: 1px solid #dfe9f6;
        border-radius: 14px;
        background: rgba(255,255,255,0.88);
      }
      .contact-card span {
        display: block;
        margin-bottom: 5px;
        color: #7a8aa4;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: .5px;
      }
      .contact-card strong {
        color: #17243c;
        font-size: 12px;
        line-height: 1.35;
      }
      .grid {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 18px;
      }
      .card {
        padding: 20px;
        border: 1px solid #dfe9f6;
        border-radius: 18px;
        background: rgba(255,255,255,0.96);
        box-shadow: 0 12px 30px rgba(35, 72, 122, 0.06);
      }
      .card h2 {
        margin: 0 0 16px;
        font-size: 16px;
        color: #17243c;
      }
      .row {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        padding: 9px 0;
        border-bottom: 1px solid #eef3fa;
        color: #445672;
        font-size: 13px;
      }
      .row:last-child { border-bottom: 0; }
      .row strong {
        color: #101a33;
        font-weight: 700;
        text-align: right;
      }
      .line-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 11px 12px;
        border-radius: 12px;
        color: #3f536f;
        background: #f5f9ff;
        font-size: 13px;
      }
      .line-item + .line-item { margin-top: 8px; }
      .line-item strong { color: #0f6fe8; }
      .total {
        margin-top: 18px;
        padding: 24px 22px;
        border-radius: 18px;
        color: #fff;
        background: linear-gradient(135deg, #1575ff 0%, #075fe2 100%);
        box-shadow: 0 16px 34px rgba(17, 107, 242, 0.24);
      }
      .total span {
        display: block;
        margin-bottom: 8px;
        opacity: .9;
        font-size: 13px;
      }
      .total strong {
        font-size: 40px;
        line-height: 1;
      }
      .note {
        margin-top: 16px;
        padding: 14px 16px;
        border: 1px solid #d8e8fb;
        border-radius: 14px;
        background: #eef6ff;
        color: #38516f;
        font-size: 12px;
        line-height: 1.5;
      }
      .muted-box {
        padding: 14px;
        border-radius: 12px;
        color: #8391a8;
        background: #f5f9ff;
        font-size: 13px;
      }
      .terms {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-top: 16px;
      }
      .term {
        padding: 13px 14px;
        border-radius: 14px;
        background: #f4f8fe;
        color: #435774;
        font-size: 11px;
        line-height: 1.45;
      }
      .term strong {
        display: block;
        margin-bottom: 4px;
        color: #17243c;
        font-size: 12px;
      }
      .footer {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid #e2ecf7;
        display: flex;
        justify-content: space-between;
        gap: 24px;
        color: #667894;
        font-size: 11px;
        line-height: 1.45;
      }
      .footer strong { color: #17243c; }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="header">
        <div class="brand-wrap">
          <img class="logo" src="${logo}" alt="КМК Cleaning Experts">
          <div>
            <div class="brand-title">${safe(COMPANY.name)} ${safe(COMPANY.subtitle)}</div>
            <div class="brand-subtitle">${safe(COMPANY.since)}</div>
          </div>
        </div>
        <div class="doc-meta">
          <strong>Предварительный расчёт</strong>
          Дата: ${safe(data.createdAt)}<br>
          ${safe(COMPANY.phone)}
        </div>
      </section>

      <h1>Фирменный расчёт стоимости уборки</h1>
      <p class="lead">Документ подготовлен по параметрам заявки. Итоговая стоимость может быть уточнена менеджером после согласования состава работ.</p>

      <section class="contact-strip">
        <div class="contact-card"><span>Телефон</span><strong>${safe(COMPANY.phone)}</strong></div>
        <div class="contact-card"><span>E-mail</span><strong>${safe(COMPANY.email)}</strong></div>
        <div class="contact-card"><span>Сайт</span><strong>${safe(COMPANY.site)}</strong></div>
      </section>

      <section class="grid">
        <div class="card">
          <h2>Параметры заказа</h2>
          <div class="row"><span>Помещение</span><strong>${safe(data.propertyType)}</strong></div>
          <div class="row"><span>Площадь</span><strong>${safe(data.area)} м²</strong></div>
          <div class="row"><span>Комнат</span><strong>${safe(data.rooms)}</strong></div>
          <div class="row"><span>Тип уборки</span><strong>${safe(data.cleaningType)}</strong></div>
          <div class="row"><span>Дата</span><strong>${safe(data.date)}</strong></div>
          <div class="row"><span>Время</span><strong>${safe(data.time)}</strong></div>
        </div>

        <div class="card">
          <h2>Итого</h2>
          <div class="row"><span>Время</span><strong>${safe(data.estimateTime)}</strong></div>
          <div class="row"><span>Бригада</span><strong>${safe(data.estimateCrew)}</strong></div>
          ${data.promoCode ? `<div class="row"><span>Промокод</span><strong>${safe(data.promoCode)}</strong></div>` : ''}
          <div class="total"><span>Предварительная стоимость</span><strong>${money(data.total)}</strong></div>
        </div>
      </section>

      <section class="grid" style="margin-top:18px;">
        <div class="card">
          <h2>Дополнительные услуги</h2>
          ${serviceRows}
        </div>

        <div class="card">
          <h2>Контакты</h2>
          <div class="row"><span>Имя</span><strong>${safe(data.name)}</strong></div>
          <div class="row"><span>Телефон</span><strong>${safe(data.phone)}</strong></div>
          <div class="row"><span>Адрес</span><strong>${safe(data.address)}</strong></div>
        </div>
      </section>

      ${data.comment ? `<div class="note"><strong>Комментарий:</strong> ${safe(data.comment)}</div>` : ''}

      <section class="terms">
        <div class="term"><strong>Надёжная команда</strong>Работы выполняют подготовленные специалисты КМК.</div>
        <div class="term"><strong>Профессиональные средства</strong>Используем оборудование и химию под задачу объекта.</div>
        <div class="term"><strong>Предварительный расчёт</strong>Цена фиксируется после подтверждения деталей заказа.</div>
      </section>

      <section class="footer">
        <span><strong>${safe(COMPANY.name)} ${safe(COMPANY.subtitle)}</strong><br>${safe(COMPANY.address)}</span>
        <span>${safe(COMPANY.secondAddress)}<br>${safe(COMPANY.email)} · ${safe(COMPANY.site)}</span>
      </section>
    </main>
  </body>
  </html>`;
}

async function generatePdf(data) {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else if (fs.existsSync(edgePath)) {
    launchOptions.executablePath = edgePath;
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(renderEstimateHtml(data), { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
    });
  } finally {
    await browser.close();
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  else if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/calculate-pdf') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if ((data.name || data.phone || data.address) && data.personalDataConsent !== true) {
        sendJson(res, 422, { error: 'Personal data consent is required' });
        return;
      }
      const pdf = await generatePdf(data);

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
        'Content-Disposition': 'attachment; filename="KMK-estimate.pdf"'
      });
      res.end(pdf);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'PDF generation failed', detail: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && ['/api/consent-log', '/api/callback', '/api/order'].includes(req.url)) {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      if (req.url === '/api/consent-log') handleConsentLog(req, res, payload);
      if (req.url === '/api/callback') handleCallback(req, res, payload);
      if (req.url === '/api/order') handleOrder(req, res, payload);
    } catch (error) {
      sendJson(res, 400, { error: 'Bad request', detail: error.message });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`KMK site is running: http://127.0.0.1:${PORT}`);
});
