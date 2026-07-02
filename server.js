const http = require('http');
const fs   = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

/* ── Load .env if present ──────────────────────────────────── */
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    });
  }
} catch { /* no .env, fine */ }

/* ── Configuration ────────────────────────────────────────── */
const ROOT             = __dirname;
const PORT             = process.env.PORT || 3000;
const DATA_DIR         = path.join(ROOT, 'data');
const CONSENT_LOG      = path.join(DATA_DIR, 'consent-log.jsonl');
const REQUEST_LOG      = path.join(DATA_DIR, 'requests.jsonl');
const CONSENT_SECRET   = process.env.CONSENT_LOG_SECRET || 'KMK_LOCAL_DEV_SECRET_CHANGE_BEFORE_PRODUCTION';
const BITRIX_WEBHOOK   = process.env.BITRIX_WEBHOOK || '';
const BITRIX_STAGE_ID  = process.env.BITRIX_STAGE_ID || 'NEW';
const BITRIX_SOURCE_ID = process.env.BITRIX_SOURCE_ID || 'WEB';
const BITRIX_ASSIGNED_BY_ID = process.env.BITRIX_ASSIGNED_BY_ID || '';
const BITRIX_TIMEOUT_MS = parseInt(process.env.BITRIX_TIMEOUT_MS, 10) || 10_000;

const RATE_LIMIT_MAX   = parseInt(process.env.RATE_LIMIT_MAX, 10) || 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const COMPANY = {
  name:          'КМК',
  subtitle:      'Cleaning Experts',
  site:          'kmk-cleaning.ru',
  phone:         '+7 (812) 327-26-83',
  email:         'mail@kmk.spb.ru',
  address:       'Санкт-Петербург, ул. Оружейника Фёдорова, 7',
  secondAddress: 'Санкт-Петербург, ул. Комсомола, 1-3 АУ',
  since:         'Профессиональный клининг в Санкт-Петербурге с 1991 года',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ── Helpers ──────────────────────────────────────────────── */
function safe(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function money(v) { return `${Number(v || 0).toLocaleString('ru-RU')} ₽`; }

function logoDataUri() {
  const buf = fs.readFileSync(path.join(ROOT, 'assets', 'logo', 'mainicon.png'));
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) { req.destroy(); reject(new Error('Body too large')); }
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
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || '';
}

function hashIp(ip) {
  return crypto.createHmac('sha256', CONSENT_SECRET).update(ip).digest('hex');
}

function cleanPhoneDigits(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('7') || d.startsWith('8')) d = d.slice(1);
  return d.slice(0, 10);
}

function appendJsonLine(filePath, entry) {
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

/* ── Rate limiter (in-memory sliding window) ──────────────── */
const rateBuckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateBuckets) {
    const fresh = hits.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, fresh);
  }
}, RATE_LIMIT_WINDOW_MS);

function isRateLimited(ip) {
  const now = Date.now();
  const hits = rateBuckets.get(ip) || [];
  const fresh = hits.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) return true;
  fresh.push(now);
  rateBuckets.set(ip, fresh);
  return false;
}

/* ── Consent entry builder ────────────────────────────────── */
function createConsentEntry(req, payload) {
  return {
    consent_uuid:       crypto.randomUUID(),
    created_at_utc:     new Date().toISOString(),
    consent_type:       String(payload.consentType  || 'unknown'),
    form_id:            String(payload.formId       || 'unknown'),
    page_url:           String(payload.pageUrl      || ''),
    document_version:   String(payload.documentVersion || ''),
    document_url:       String(payload.documentUrl  || ''),
    accepted:           Boolean(payload.accepted),
    marketing_accepted: Boolean(payload.marketingAccepted),
    offer_accepted:     Boolean(payload.offerAccepted),
    cookie_categories:  payload.cookieCategories || null,
    ip_hash:            hashIp(getClientIp(req)),
    user_agent:         String(req.headers['user-agent'] || ''),
    request_reference:  String(payload.requestReference || ''),
    metadata_json:      payload.metadata || null,
  };
}

/* ── Bitrix integration ───────────────────────────────────── */
const https = require('https');

function bitrixBaseUrl() {
  if (!BITRIX_WEBHOOK) return null;
  try {
    const url = new URL(BITRIX_WEBHOOK);
    const parts = url.pathname.split('/').filter(Boolean);
    const restIndex = parts.indexOf('rest');
    if (restIndex === -1 || parts.length < restIndex + 3) return null;
    const base = `/${parts.slice(0, restIndex + 3).join('/')}`;
    return { protocol: url.protocol, hostname: url.hostname, port: url.port, base };
  } catch { return null; }
}

function bitrixCall(method, payload = {}) {
  const cfg = bitrixBaseUrl();
  if (!cfg) { console.log('[Bitrix] Webhook not configured, skipping'); return Promise.resolve(null); }

  const normalizedMethod = method.endsWith('.json') ? method : `${method}.json`;
  const requestPath = `${cfg.base}/${normalizedMethod}`;
  const postData = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const proto = cfg.protocol === 'https:' ? https : http;
    const r = proto.request({
      hostname: cfg.hostname,
      port: cfg.port || (cfg.protocol === 'https:' ? 443 : 80),
      path: requestPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`[Bitrix] ${method} → ${res.statusCode}:`, data.slice(0, 500));
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* handled below */ }
        if (res.statusCode >= 400 || parsed?.error) {
          const message = parsed?.error_description || parsed?.error || `HTTP ${res.statusCode}`;
          const error = new Error(`Bitrix ${method}: ${message}`);
          error.response = parsed;
          reject(error);
          return;
        }
        resolve(parsed);
      });
    });
    r.setTimeout(BITRIX_TIMEOUT_MS, () => r.destroy(new Error(`Bitrix ${method}: timeout`)));
    r.on('error', err => { console.error(`[Bitrix] ${method} error:`, err.message); reject(err); });
    r.write(postData);
    r.end();
  });
}

async function bitrixFindContactByPhone(phone) {
  const result = await bitrixCall('crm.contact.list', {
    filter: { PHONE: phone },
    select: ['ID', 'NAME', 'PHONE'],
  });
  if (result?.result?.length) return result.result[0].ID;
  return null;
}

async function bitrixCreateContact(name, phone) {
  const fields = {
    NAME: name || 'Без имени',
    PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],
    SOURCE_ID: BITRIX_SOURCE_ID,
  };
  if (BITRIX_ASSIGNED_BY_ID) fields.ASSIGNED_BY_ID = Number(BITRIX_ASSIGNED_BY_ID);
  const result = await bitrixCall('crm.contact.add', { fields });
  return result?.result || null;
}

async function bitrixAddContactAndDeal(dealFields, contactName, contactPhone) {
  if (!bitrixBaseUrl()) { console.log('[Bitrix] Webhook not configured, skipping'); return null; }

  let contactId = await bitrixFindContactByPhone(contactPhone);
  if (!contactId && contactName) {
    contactId = await bitrixCreateContact(contactName, contactPhone);
    console.log('[Bitrix] Created contact:', contactId);
  }

  if (contactId) {
    dealFields.CONTACT_ID = contactId;
  }

  const dealResult = await bitrixCall('crm.deal.add', { fields: dealFields });
  console.log('[Bitrix] Deal created:', dealResult?.result);
  return dealResult;
}

function buildBitrixDealFields(fields) {
  const dealFields = {
    STAGE_ID: BITRIX_STAGE_ID,
    SOURCE_ID: BITRIX_SOURCE_ID,
    ...fields,
  };
  if (BITRIX_ASSIGNED_BY_ID) dealFields.ASSIGNED_BY_ID = Number(BITRIX_ASSIGNED_BY_ID);
  return dealFields;
}

/* ── API handlers ─────────────────────────────────────────── */
function handleConsentLog(req, res, payload) {
  if (!payload || payload.accepted !== true) {
    return sendJson(res, 422, { error: 'Consent is required' });
  }
  appendJsonLine(CONSENT_LOG, createConsentEntry(req, payload));
  sendJson(res, 200, { ok: true });
}

function handleCallback(req, res, payload) {
  if (!payload || payload.personalDataConsent !== true) {
    return sendJson(res, 422, { error: 'Personal data consent is required' });
  }

  const name    = String(payload.name || '').trim().slice(0, 200);
  const digits  = cleanPhoneDigits(payload.phone);
  if (digits.length !== 10) {
    return sendJson(res, 422, { error: 'Valid phone is required' });
  }

  const requestReference = crypto.randomUUID();
  appendJsonLine(REQUEST_LOG, {
    request_reference: requestReference,
    created_at_utc:    new Date().toISOString(),
    type: 'callback',
    name,
    phone: `+7${digits}`,
    page_url:  String(payload.pageUrl || ''),
    user_agent: String(req.headers['user-agent'] || ''),
  });
  appendJsonLine(CONSENT_LOG, createConsentEntry(req, {
    consentType: 'personal_data', formId: 'footer_callback',
    pageUrl: payload.pageUrl, documentVersion: payload.documentVersion,
    documentUrl: '/personal-data-consent/', accepted: true,
    requestReference, metadata: { source: 'footer_callback' },
  }));

  bitrixAddContactAndDeal(buildBitrixDealFields({
    TITLE: `Звонок: ${name || 'Неизвестно'} — ${COMPANY.phone}`,
    COMMENTS: `Заявка на обратный звонок\nИмя: ${name}\nТелефон: +7${digits}\nСтраница: ${payload.pageUrl || ''}`,
  }), name, `+7${digits}`).catch(e => console.error('[Bitrix] Callback deal failed:', e.message));

  sendJson(res, 200, { ok: true, requestReference });
}

function handleOrder(req, res, payload) {
  if (!payload || payload.personalDataConsent !== true || payload.offerAccepted !== true) {
    return sendJson(res, 422, { error: 'Required consent is missing' });
  }

  const name   = String(payload.name || '').trim().slice(0, 200);
  const digits = cleanPhoneDigits(payload.phone);
  if (digits.length !== 10) {
    return sendJson(res, 422, { error: 'Valid phone is required' });
  }

  const address = String(payload.address || '').trim().slice(0, 500);
  const comment = String(payload.comment || '').trim().slice(0, 1000);

  const requestReference = crypto.randomUUID();
  const serviceNames = (payload.services || []).map(s => s.name).join(', ');
  const comments = [
    `Тип: ${payload.propertyType || ''}, Площадь: ${payload.area || ''} м²`,
    `Комнат: ${payload.rooms || ''}, Уборка: ${payload.cleaningType || ''}`,
    serviceNames ? `Доп. услуги: ${serviceNames}` : '',
    `Дата: ${payload.date || ''}, Время: ${payload.time || ''}`,
    `Адрес: ${address}`,
    comment ? `Комментарий: ${comment}` : '',
    `Стоимость: ${payload.total || 0} ₽`,
  ].filter(Boolean).join('\n');

  appendJsonLine(REQUEST_LOG, {
    request_reference: requestReference,
    created_at_utc:    new Date().toISOString(),
    type: 'order',
    estimate: {
      propertyType: payload.propertyType, area: payload.area,
      rooms: payload.rooms, cleaningType: payload.cleaningType,
      services: payload.services, date: payload.date, time: payload.time,
      total: payload.total, promoCode: payload.promoCode || '',
    },
    contact: { name, phone: `+7${digits}`, address, comment },
    marketing_accepted: Boolean(payload.marketingAccepted),
    page_url:  String(payload.pageUrl || ''),
    user_agent: String(req.headers['user-agent'] || ''),
  });

  appendJsonLine(CONSENT_LOG, createConsentEntry(req, {
    consentType: 'public_offer', formId: 'calculator_order',
    pageUrl: payload.pageUrl, documentVersion: payload.documentVersion,
    documentUrl: '/public-offer/', accepted: true, offerAccepted: true,
    marketingAccepted: Boolean(payload.marketingAccepted), requestReference,
  }));

  bitrixAddContactAndDeal(buildBitrixDealFields({
    TITLE: `Заказ: ${name || 'Неизвестно'} — ${payload.total || 0} ₽`,
    OPPORTUNITY: payload.total || 0,
    CURRENCY_ID: 'RUB',
    COMMENTS: comments,
  }), name, `+7${digits}`).catch(e => console.error('[Bitrix] Order deal failed:', e.message));

  sendJson(res, 200, { ok: true, requestReference });
}

/* ── Static file server ───────────────────────────────────── */
function serveStatic(req, res) {
  const url    = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  else if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ── Server ───────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  /* Rate limit check for API POST endpoints */
  if (req.method === 'POST' && ['/api/consent-log', '/api/callback', '/api/order'].includes(req.url)) {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return sendJson(res, 429, { error: 'Too many requests. Please try again later.' });
    }
  }

  /* Test Bitrix integration */
  if (req.method === 'GET' && req.url === '/api/test-bitrix') {
    if (!bitrixBaseUrl()) {
      return sendJson(res, 503, { ok: false, error: 'BITRIX_WEBHOOK is not configured' });
    }
    console.log('[Bitrix] Test request received');
    try {
      const result = await bitrixAddContactAndDeal(buildBitrixDealFields({
      TITLE: `Тестовая сделка — ${new Date().toLocaleTimeString('ru-RU')}`,
      COMMENTS: 'Тест интеграции с сайта KMK',
      }), 'Тест Тестов', '+79991234567');
      return sendJson(res, 200, { ok: true, bitrixResult: result });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message, bitrixResponse: error.response || null });
    }
  }

  /* Bitrix webhook status */
  if (req.method === 'GET' && req.url === '/api/bitrix-status') {
    const configured = Boolean(BITRIX_WEBHOOK);
    const cfg = configured ? bitrixBaseUrl() : null;
    const webhookValid = Boolean(cfg?.hostname && cfg?.base);
    return sendJson(res, 200, {
      configured,
      webhookValid,
      hostname: webhookValid ? cfg.hostname : null,
      stageId: BITRIX_STAGE_ID,
      sourceId: BITRIX_SOURCE_ID,
      assignedById: BITRIX_ASSIGNED_BY_ID || null,
    });
  }

  /* API POST endpoints */
  if (req.method === 'POST' && ['/api/consent-log', '/api/callback', '/api/order'].includes(req.url)) {
    try {
      const body    = await readBody(req);
      const payload = JSON.parse(body || '{}');
      if (req.url === '/api/consent-log') handleConsentLog(req, res, payload);
      if (req.url === '/api/callback')    handleCallback(req, res, payload);
      if (req.url === '/api/order')       handleOrder(req, res, payload);
    } catch (error) {
      sendJson(res, 400, { error: 'Bad request', detail: error.message });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`KMK site is running: http://127.0.0.1:${PORT}`);
  console.log(`  Rate limit: ${RATE_LIMIT_MAX} requests / ${RATE_LIMIT_WINDOW_MS / 1000}s per IP`);
  console.log(`  Bitrix webhook: ${BITRIX_WEBHOOK ? 'configured' : 'NOT SET (set BITRIX_WEBHOOK env var)'}`);
});
