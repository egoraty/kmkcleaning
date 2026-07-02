/*  KMK Cleaning Experts – client bundle  */
(() => {
  'use strict';

  /* ── State ───────────────────────────────────────────────── */
  const state = {
    currentStep: 1,
    propertyType: 'apartment',
    area: 50,
    rooms: 2,
    cleaningType: 'general',
    additionalServices: [],
    date: 'today',
    time: 'afternoon',
    name: '',
    phone: '',
    address: '',
    comment: '',
    promoCode: '',
    promoApplied: false,
    personalConsentLogged: false,
    marketingConsentLogged: false,
    offerConsentLogged: false,
  };

  const CONSENT_DOC_VERSION = '2026-07-01-v1';
  const COOKIE_CONSENT_VERSION = '2026-07-01-v1';

  /* ── Pricing ─────────────────────────────────────────────── */
  const pricing = {
    base: {
      apartment: { maintenance: 250, general: 317, postRenovation: 433 },
      house:     { maintenance: 287, general: 360, postRenovation: 480 },
    },
    services: { microwave: 500, windows: 2500, fridge: 700, oven: 900, hood: 750 },
  };
  const promoDiscounts = { KMK30: 0.3 };
  const roomMult = { 1: 1, 2: 1, 3: 1.1, 4: 1.15, 5: 1.2 };

  /* ── Helpers ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function money(v) { return `${Number(v || 0).toLocaleString('ru-RU')} ₽`; }

  /* ── Phone mask ──────────────────────────────────────────── */
  function getPhoneDigits(v) {
    let d = v.replace(/\D/g, '');
    if (d.startsWith('7') || d.startsWith('8')) d = d.slice(1);
    return d.slice(0, 10);
  }

  function formatPhoneInput(v) {
    const d = getPhoneDigits(v);
    let r = '+7';
    if (d.length > 0) r += ` (${d.slice(0, 3)}`;
    if (d.length >= 3) r += `) ${d.slice(3, 6)}`;
    if (d.length >= 6) r += `-${d.slice(6, 8)}`;
    if (d.length >= 8) r += `-${d.slice(8, 10)}`;
    return r === '+7' ? '+7 (' : r;
  }

  function attachPhoneMask(input) {
    if (!input) return;
    input.addEventListener('focus', () => { if (!input.value.trim()) input.value = '+7 (9'; });
    input.addEventListener('input', () => {
      input.value = formatPhoneInput(input.value);
      input.setSelectionRange(input.value.length, input.value.length);
    });
    input.addEventListener('blur', () => { if (getPhoneDigits(input.value).length <= 1) input.value = ''; });
  }

  /* ── Address suggestions ─────────────────────────────────── */
  const streets = [
    'Невский проспект','Лиговский проспект','Московский проспект','Литейный проспект',
    'Комендантский проспект','Проспект Просвещения','Гражданский проспект','Ленинский проспект',
    'ул. Софийская','ул. Савушкина','ул. Дыбенко','ул. Бухарестская','ул. Коллонтай',
    'ул. Белы Куна','ул. Типанова','ул. Восстания','ул. Марата','ул. Рубинштейна',
    'ул. Жуковского','ул. Есенина','ул. Варшавская','ул. Бассейная','ул. Турку',
    'Пулковское шоссе','Выборгское шоссе','Пискарёвский проспект',
  ];

  function initAddressSuggest() {
    const input = $('address');
    const box = $('addressSuggestions');
    if (!input || !box) return;
    const hide = () => box.classList.remove('visible');

    input.addEventListener('input', () => {
      const q = input.value.trim().split(',')[0].trim().toLowerCase();
      if (q.length < 2) { hide(); return; }
      const matches = streets.filter(s => s.toLowerCase().includes(q)).slice(0, 6);
      if (!matches.length) { hide(); return; }
      box.innerHTML = matches.map(s => `<div class="address-suggestion" data-address="${s}">${s}</div>`).join('');
      box.classList.add('visible');
    });

    box.addEventListener('click', e => {
      const item = e.target.closest('.address-suggestion');
      if (!item) return;
      input.value = `${item.dataset.address}, `;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      hide();
    });

    document.addEventListener('click', e => { if (!e.target.closest('.address-field')) hide(); });
  }

  /* ── Date / Time ─────────────────────────────────────────── */
  function formatDateValue(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatDateOption(d, offset) {
    const day = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const wd  = d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
    if (offset === 0) return `Сегодня, ${day}`;
    if (offset === 1) return `Завтра, ${day}`;
    return `${wd}, ${day}`;
  }

  function initDateTime() {
    const dateSelect  = $('bookingDate');
    const timeSelect  = $('bookingTime');
    if (dateSelect) {
      dateSelect.innerHTML = '';
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const opt = document.createElement('option');
        opt.value = formatDateValue(d);
        opt.textContent = formatDateOption(d, i);
        dateSelect.appendChild(opt);
      }
      state.date = dateSelect.value;
      dateSelect.addEventListener('change', function () { state.date = this.value; });
    }
    if (timeSelect) {
      state.time = timeSelect.value;
      timeSelect.addEventListener('change', function () { state.time = this.value; });
    }
  }

  /* ── Calculations ────────────────────────────────────────── */
  function calcPriceBeforeDiscount() {
    let base = pricing.base[state.propertyType][state.cleaningType] * state.area * roomMult[state.rooms];
    state.additionalServices.forEach(s => { base += pricing.services[s]; });
    return Math.round(base / 100) * 100;
  }

  function calcPrice() {
    let base = calcPriceBeforeDiscount();
    if (state.promoApplied) base *= 1 - (promoDiscounts[state.promoCode] || 0);
    return Math.round(base / 100) * 100;
  }

  function estTime() {
    const h = Math.ceil(
      state.area / 25 *
      (state.cleaningType === 'maintenance' ? 0.8 : state.cleaningType === 'general' ? 1 : 1.5) +
      state.additionalServices.length * 0.5,
    );
    return `${h}–${h + 1} ч`;
  }

  function estCrew() {
    return state.area < 60 ? '1–2 чел.' : state.area < 100 ? '2–3 чел.' : '3–4 чел.';
  }

  function fmtDate(d) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y, m - 1, day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }).replace('.', '');
    }
    return { today: 'Сегодня', tomorrow: 'Завтра', dayAfter: 'Послезавтра' }[d] || d;
  }
  function fmtTime(t) { return { morning: '09–12', afternoon: '12–15', evening: '15–18', night: '18–21' }[t] || t; }
  function fmtRooms(r) { return r === '5' ? '5+' : r; }
  function fmtCleaning(t) { return { maintenance: 'Поддерживающая', general: 'Генеральная', postRenovation: 'После ремонта' }[t] || t; }
  function fmtProperty(t) { return t === 'apartment' ? 'Квартира' : 'Дом'; }

  /* ── UI update ───────────────────────────────────────────── */
  function updateUI() {
    $('stepTitle').textContent = `Шаг ${state.currentStep} из 4`;

    document.querySelectorAll('.step-dot').forEach(d => {
      const s = +d.dataset.step;
      d.classList.remove('active', 'done');
      if (s === state.currentStep) d.classList.add('active');
      if (s < state.currentStep) d.classList.add('done');
    });
    document.querySelectorAll('.step-labels span').forEach(l => {
      const s = +l.dataset.step;
      l.classList.remove('active', 'done');
      if (s === state.currentStep) l.classList.add('active');
      if (s < state.currentStep) l.classList.add('done');
    });
    document.querySelectorAll('.calc-panel').forEach(p => p.classList.remove('active'));
    $(`step${state.currentStep}`).classList.add('active');
    $('prevBtn').disabled = state.currentStep === 1;

    if (state.currentStep === 4) {
      $('nextBtn').style.display = 'none';
      updateSummary();
    } else {
      $('nextBtn').style.display = '';
      $('nextBtn').textContent = state.currentStep === 3 ? 'Готово' : 'Далее';
    }
  }

  function updateSummary() {
    $('sumPropertyType').textContent = fmtProperty(state.propertyType);
    $('sumArea').textContent          = `${state.area} м²`;
    $('sumRooms').textContent         = fmtRooms(state.rooms);
    $('sumCleaningType').textContent  = fmtCleaning(state.cleaningType);

    const svc = $('sumServices');
    const names = { microwave: 'Микроволновка', windows: 'Мойка окон', fridge: 'Холодильник', oven: 'Духовка', hood: 'Вытяжка' };
    if (!state.additionalServices.length) {
      svc.innerHTML = '<div class="summary-row"><span class="label">Нет</span><span class="value"></span></div>';
    } else {
      svc.innerHTML = state.additionalServices
        .map(s => `<div class="summary-row"><span class="label">${names[s]}</span><span class="value">+${pricing.services[s].toLocaleString()} ₽</span></div>`)
        .join('');
    }

    $('sumDate').textContent    = fmtDate(state.date);
    $('sumTime').textContent    = fmtTime(state.time);
    $('sumName').textContent    = state.name || '-';
    $('sumPhone').textContent   = state.phone || '-';
    $('sumAddress').textContent = state.address || '-';
    const priceBeforeDiscount = calcPriceBeforeDiscount();
    const priceAfterDiscount = calcPrice();
    const oldPrice = $('totalOldPrice');
    if (oldPrice) {
      oldPrice.textContent = `${priceBeforeDiscount.toLocaleString()} ₽`;
      oldPrice.hidden = !(state.promoApplied && priceAfterDiscount < priceBeforeDiscount);
    }
    $('totalPrice').textContent = `${priceAfterDiscount.toLocaleString()} ₽`;
    $('estTime').textContent    = estTime();
    $('estCrew').textContent    = estCrew();
  }

  /* ── Controls ────────────────────────────────────────────── */
  function initSegmented() {
    document.querySelectorAll('.segmented[data-field]').forEach(group => {
      group.querySelectorAll('span[data-value]').forEach(opt => {
        opt.addEventListener('click', function () {
          group.querySelectorAll('span[data-value]').forEach(s => s.classList.remove('selected'));
          this.classList.add('selected');
          state[group.dataset.field] = this.dataset.value;
        });
      });
    });
    $('areaInput').addEventListener('input', function () { state.area = parseInt(this.value) || 50; });
  }

  function initCleaningTypes() {
    document.querySelectorAll('.type-card[data-cleaning]').forEach(card => {
      const toggle = card.querySelector('.type-details-toggle');
      if (toggle) {
        toggle.addEventListener('click', e => {
          e.stopPropagation();
          const open = !card.classList.contains('expanded');
          document.querySelectorAll('.type-card.expanded').forEach(c => {
            c.classList.remove('expanded');
            c.querySelector('.type-details-toggle')?.setAttribute('aria-expanded', 'false');
          });
          card.classList.toggle('expanded', open);
          toggle.setAttribute('aria-expanded', String(open));
        });
      }
      card.addEventListener('click', () => {
        document.querySelectorAll('.type-card[data-cleaning]').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.cleaningType = card.dataset.cleaning;
      });
    });
  }

  function initServices() {
    document.querySelectorAll('.service-option[data-service]').forEach(opt => {
      opt.addEventListener('click', function () {
        this.classList.toggle('active');
        const s = this.dataset.service;
        if (this.classList.contains('active')) state.additionalServices.push(s);
        else state.additionalServices = state.additionalServices.filter(x => x !== s);
      });
    });
  }

  function syncServicePrices() {
    document.querySelectorAll('.service-option[data-service]').forEach(opt => {
      const price = pricing.services[opt.dataset.service];
      const el = opt.querySelector('.service-price');
      if (el && Number.isFinite(price)) el.textContent = `+${price.toLocaleString('ru-RU')} ₽`;
    });
  }

  function setSegmentedValue(field, value) {
    const group = document.querySelector(`.segmented[data-field="${field}"]`);
    if (!group) return;
    group.querySelectorAll('span[data-value]').forEach(o => o.classList.toggle('selected', o.dataset.value === String(value)));
    state[field] = value;
  }

  function setCleaningValue(value) {
    document.querySelectorAll('.type-card[data-cleaning]').forEach(c => c.classList.toggle('active', c.dataset.cleaning === value));
    state.cleaningType = value;
  }

  function setAdditionalService(service, enabled = true) {
    const opt = document.querySelector(`.service-option[data-service="${service}"]`);
    if (!opt) return;
    opt.classList.toggle('active', enabled);
    state.additionalServices = state.additionalServices.filter(x => x !== service);
    if (enabled) state.additionalServices.push(service);
  }

  function openCalculatorFromService(service) {
    if (service === 'house') {
      setSegmentedValue('propertyType', 'house');
      setCleaningValue('general');
      state.currentStep = 1;
    } else if (service === 'postRenovation') {
      setSegmentedValue('propertyType', 'apartment');
      setCleaningValue('postRenovation');
      state.currentStep = 1;
    } else if (service === 'windows') {
      setAdditionalService('windows', true);
      state.currentStep = 2;
    } else {
      setSegmentedValue('propertyType', 'apartment');
      setCleaningValue('general');
      state.currentStep = 1;
    }
    updateUI();
    scrollToCalculatorCenter();
  }

  function scrollToCalculatorCenter() {
    alignSectionToTop('calculator');
    history.replaceState(null, '', '#calculator');
  }

  /* ── Promo ───────────────────────────────────────────────── */
  function applyPromo() {
    const code = $('promoCode').value.trim().toUpperCase();
    const msg  = $('promoMessage');
    state.promoCode = code;
    state.promoApplied = Boolean(promoDiscounts[code]);

    if (!code) {
      msg.textContent = '';
      msg.className = 'promo-message';
    } else if (state.promoApplied) {
      msg.textContent = `Скидка ${Math.round(promoDiscounts[code] * 100)}% применена`;
      msg.className = 'promo-message success';
    } else {
      msg.textContent = 'Промокод не найден';
      msg.className = 'promo-message error';
    }
    updateSummary();
  }

  /* ── Validation ──────────────────────────────────────────── */
  function validateCheckboxConsent(inputId, errorId) {
    const input = $(inputId);
    const error = $(errorId);
    const wrap  = input?.closest('.calc-consent-lines, .consent-card, .callback-consent, .order-consent-card');
    const ok = Boolean(input && input.checked);
    wrap?.classList.toggle('error', !ok);
    error?.classList.toggle('visible', !ok);
    return ok;
  }

  function validate(step) {
    const err = $('validationError');
    if (err) err.classList.remove('visible');

    if (step === 1) {
      const areaInput = $('areaInput');
      if (state.area < 10 || state.area > 500) { areaInput.classList.add('error'); return false; }
      areaInput.classList.remove('error');
      return true;
    }

    if (step === 3) {
      const n = $('name').value.trim();
      const p = $('phone').value.trim();
      const a = $('address').value.trim();
      const personalConsent  = $('calcPersonalConsent');
      const marketingConsent = $('calcMarketingConsent');
      let ok = true;

      [['name', n], ['phone', getPhoneDigits(p).length === 10], ['address', a]].forEach(([id, v]) => {
        const el  = $(id);
        const msg = $(id + 'Error');
        if (!v) { el.classList.add('error'); msg.classList.add('visible'); ok = false; }
        else    { el.classList.remove('error'); msg.classList.remove('visible'); }
      });

      if (!validateCheckboxConsent('calcPersonalConsent', 'calcPersonalConsentError')) ok = false;
      state.name = n;
      state.phone = p;
      state.address = a;
      state.comment = $('comment').value.trim();

      if (ok && personalConsent.checked && !state.personalConsentLogged) {
        logConsent({
          consentType: 'personal_data', formId: 'calculator_step_3',
          documentUrl: '/legal/personal-data-consent/', accepted: true,
          marketingAccepted: Boolean(marketingConsent.checked),
          metadata: { hasAddress: true, hasComment: Boolean(state.comment) },
        });
        state.personalConsentLogged = true;
      }
      if (ok && marketingConsent.checked && !state.marketingConsentLogged) {
        logConsent({
          consentType: 'marketing', formId: 'calculator_step_3',
          documentUrl: '/legal/marketing-consent/', accepted: true,
          marketingAccepted: true,
        });
        state.marketingConsentLogged = true;
      }
      return ok;
    }
    return true;
  }

  function goToStep(targetStep) {
    if (!targetStep || targetStep === state.currentStep || targetStep < 1 || targetStep > 4) return;
    if (targetStep < state.currentStep) {
      state.currentStep = targetStep;
      updateUI();
      keepCalculatorInView();
      return;
    }
    while (state.currentStep < targetStep) {
      if (!validate(state.currentStep)) { updateUI(); return; }
      state.currentStep++;
    }
    updateUI();
    keepCalculatorInView();
  }

  function nextStep() { goToStep(state.currentStep + 1); }
  function prevStep() { goToStep(state.currentStep - 1); }

  /* ── Consent ─────────────────────────────────────────────── */
  function initConsentControls() {
    ['calcPersonalConsent', 'callbackPersonalConsent', 'orderOfferConsent'].forEach(id => {
      const input = $(id);
      if (!input) return;
      input.addEventListener('change', () => {
        const errorId = id === 'calcPersonalConsent' ? 'calcPersonalConsentError'
          : id === 'callbackPersonalConsent' ? 'callbackConsentError'
          : 'orderOfferConsentError';
        if (input.checked) {
          input.closest('.calc-consent-lines, .consent-card, .callback-consent, .order-consent-card')?.classList.remove('error');
          $(errorId)?.classList.remove('visible');
        }
      });
    });
  }

  function buildConsentPayload(payload) {
    return { documentVersion: CONSENT_DOC_VERSION, pageUrl: location.href, ...payload };
  }

  function logConsent(payload) {
    fetch('/api/consent-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildConsentPayload(payload)),
    }).catch(() => {});
  }

  /* ── Callback form ───────────────────────────────────────── */
  async function submitCallback() {
    const nameInput  = $('callbackName');
    const phoneInput = $('callbackPhone');
    const consentBox = $('callbackConsent');
    const status     = $('callbackStatus');
    const name  = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const phoneOk = getPhoneDigits(phone).length === 10;

    consentBox.classList.add('visible');
    status.textContent = '';
    status.className = 'callback-status';

    if (!name) {
      nameInput.classList.add('error');
      status.textContent = 'Введите имя';
      status.classList.add('error');
      return;
    }
    nameInput.classList.remove('error');

    if (!phoneOk) {
      phoneInput.classList.add('error');
      status.textContent = 'Введите телефон полностью';
      status.classList.add('error');
      return;
    }
    phoneInput.classList.remove('error');
    if (!validateCheckboxConsent('callbackPersonalConsent', 'callbackConsentError')) return;

    try {
      const res = await fetch('/api/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, phone,
          personalDataConsent: true,
          documentVersion: CONSENT_DOC_VERSION,
          pageUrl: location.href,
        }),
      });
      if (!res.ok) throw new Error('callback failed');
      status.textContent = 'Спасибо! Перезвоним в рабочее время.';
      status.classList.add('success');
      nameInput.value = '';
      phoneInput.value = '';
      $('callbackPersonalConsent').checked = false;
    } catch {
      status.textContent = 'Не получилось отправить. Позвоните нам: +7 (812) 327-26-83';
      status.classList.add('error');
    }
  }

  /* ── Order ───────────────────────────────────────────────── */
  function buildEstimatePayload() {
    const svcNames = { microwave: 'Микроволновка', windows: 'Мойка окон', fridge: 'Холодильник', oven: 'Духовка', hood: 'Вытяжка' };
    return {
      createdAt: new Date().toLocaleDateString('ru-RU'),
      propertyType: fmtProperty(state.propertyType),
      area: state.area,
      rooms: fmtRooms(state.rooms),
      cleaningType: fmtCleaning(state.cleaningType),
      services: state.additionalServices.map(id => ({ name: svcNames[id], price: pricing.services[id] })),
      date: fmtDate(state.date),
      time: fmtTime(state.time),
      name: state.name || $('name').value.trim(),
      phone: state.phone || $('phone').value.trim(),
      address: state.address || $('address').value.trim(),
      comment: state.comment || $('comment').value.trim(),
      promoCode: state.promoApplied ? state.promoCode : '',
      estimateTime: estTime(),
      estimateCrew: estCrew(),
      total: calcPrice(),
      personalDataConsent: Boolean($('calcPersonalConsent')?.checked),
      marketingAccepted: Boolean($('calcMarketingConsent')?.checked),
      documentVersion: CONSENT_DOC_VERSION,
      pageUrl: location.href,
    };
  }

  async function confirmOrder() {
    if (!validateCheckboxConsent('orderOfferConsent', 'orderOfferConsentError')) return;
    if (!state.offerConsentLogged) {
      logConsent({
        consentType: 'public_offer', formId: 'calculator_order',
        documentUrl: '/legal/public-offer/', accepted: true, offerAccepted: true,
      });
      state.offerConsentLogged = true;
    }
    try {
      await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...buildEstimatePayload(),
          personalDataConsent: true,
          offerAccepted: true,
          marketingAccepted: Boolean($('calcMarketingConsent')?.checked),
          documentVersion: CONSENT_DOC_VERSION,
          pageUrl: location.href,
        }),
      });
    } catch { /* logged server-side */ }
    $('confirmModal').classList.add('visible');
  }

  /* ── Gallery ─────────────────────────────────────────────── */
  function openGallery()  { $('galleryModal').classList.add('visible'); document.body.style.overflow = 'hidden'; }
  function closeGallery() { $('galleryModal').classList.remove('visible'); document.body.style.overflow = ''; }

  function filterWorks(type, el) {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.work-card').forEach(card => {
      card.style.display = (type === 'all' || card.dataset.type === type) ? '' : 'none';
    });
  }

  /* ── Modals ──────────────────────────────────────────────── */
  function closeModal(id) { $(id).classList.remove('visible'); }
  document.querySelectorAll('.modal-overlay').forEach(o =>
    o.addEventListener('click', function (e) { if (e.target === this) this.classList.remove('visible'); }),
  );
  $('galleryModal').addEventListener('click', function (e) { if (e.target === this) closeGallery(); });

  /* ── Cookie consent ──────────────────────────────────────── */
  function initCookieConsent() {
    const saved = readCookieConsent();
    if (!saved || saved.version !== COOKIE_CONSENT_VERSION) {
      $('cookieBanner')?.classList.add('visible');
      return;
    }
    applyCookieConsent(saved);
  }

  function readCookieConsent() {
    try { return JSON.parse(localStorage.getItem('kmkCookieConsent') || 'null'); }
    catch { return null; }
  }

  function saveCookieConsent(opts) {
    const consent = {
      version: COOKIE_CONSENT_VERSION, necessary: true,
      analytics: Boolean(opts.analytics), marketing: Boolean(opts.marketing),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem('kmkCookieConsent', JSON.stringify(consent));
    $('cookieBanner')?.classList.remove('visible');
    closeModal('cookieSettingsModal');
    applyCookieConsent(consent);
    logConsent({
      consentType: 'cookie', formId: 'cookie_banner',
      documentUrl: '/legal/cookie-policy/', accepted: true,
      cookieCategories: { necessary: true, analytics: consent.analytics, marketing: consent.marketing },
    });
  }

  function openCookieSettings() {
    const saved = readCookieConsent() || {};
    $('cookieAnalytics').checked  = Boolean(saved.analytics);
    $('cookieMarketing').checked = Boolean(saved.marketing);
    $('cookieSettingsModal').classList.add('visible');
  }

  function saveCookieSettings() {
    saveCookieConsent({
      analytics: $('cookieAnalytics').checked,
      marketing: $('cookieMarketing').checked,
    });
  }

  function applyCookieConsent(consent) {
    window.kmkCookieConsent = consent;
    if (consent.analytics)  document.dispatchEvent(new CustomEvent('kmk:analytics-consent'));
    if (consent.marketing)  document.dispatchEvent(new CustomEvent('kmk:marketing-consent'));
  }

  /* ── PDF generation (client-side, jsPDF) ─────────────────── */
  async function loadJsPDF() {
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;

    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Не удалось загрузить jsPDF'));
      document.head.appendChild(s);
    });

    const fontUrl = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/fonts/Russian-Regular.js';
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = fontUrl;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Не удалось загрузить шрифт'));
      document.head.appendChild(s);
    });

    return window.jspdf.jsPDF;
  }

  async function generatePdfClient() {
    const JsPDF = await loadJsPDF();
    const doc   = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const data  = buildEstimatePayload();

    doc.setFont('Russian');
    doc.setFontSize(10);
    doc.setTextColor(100);

    let y = 20;

    // Header
    doc.setFontSize(20);
    doc.setTextColor(15, 111, 232);
    doc.text('KMK Cleaning Experts', 20, y);
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text('Профессиональный клининг в Санкт-Петербурге с 1991 года', 20, y);
    y += 8;

    doc.setFontSize(16);
    doc.setTextColor(16, 26, 51);
    doc.text('Расчёт стоимости уборки', 20, y);
    y += 12;

    // Contact info
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(`Телефон: +7 (812) 327-26-83   |   kmk-cleaning.ru   |   ${data.createdAt}`, 20, y);
    y += 10;

    // Divider
    doc.setDrawColor(200);
    doc.line(20, y, 190, y);
    y += 10;

    // Parameters
    doc.setFontSize(12);
    doc.setTextColor(16, 26, 51);
    doc.text('Параметры заказа', 20, y);
    y += 8;

    doc.setFontSize(10);
    doc.setTextColor(60);
    const params = [
      ['Помещение', data.propertyType],
      ['Площадь', `${data.area} м²`],
      ['Комнат', String(data.rooms)],
      ['Тип уборки', data.cleaningType],
      ['Дата', data.date],
      ['Время', data.time],
    ];
    params.forEach(([label, value]) => {
      doc.text(`${label}:`, 20, y);
      doc.text(String(value), 80, y);
      y += 6;
    });
    y += 5;

    // Services
    if (data.services.length) {
      doc.setFontSize(12);
      doc.setTextColor(16, 26, 51);
      doc.text('Дополнительные услуги', 20, y);
      y += 8;
      doc.setFontSize(10);
      doc.setTextColor(60);
      data.services.forEach(s => {
        doc.text(`${s.name}`, 20, y);
        doc.text(`+${s.price.toLocaleString('ru-RU')} ₽`, 140, y);
        y += 6;
      });
      y += 5;
    }

    // Total
    doc.setFillColor(21, 117, 255);
    doc.roundedRect(20, y, 170, 20, 3, 3, 'F');
    doc.setFontSize(12);
    doc.setTextColor(255);
    doc.text('Итого:', 25, y + 8);
    doc.setFontSize(18);
    doc.text(`${data.total.toLocaleString('ru-RU')} ₽`, 130, y + 10);
    y += 28;

    // Contact
    doc.setFontSize(12);
    doc.setTextColor(16, 26, 51);
    doc.text('Контактные данные', 20, y);
    y += 8;
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text(`Имя: ${data.name}`, 20, y); y += 6;
    doc.text(`Телефон: ${data.phone}`, 20, y); y += 6;
    doc.text(`Адрес: ${data.address}`, 20, y); y += 6;
    if (data.comment) { doc.text(`Комментарий: ${data.comment}`, 20, y); y += 6; }

    // Footer
    y = 280;
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text('KMK Cleaning Experts | Санкт-Петербург | kmk-cleaning.ru', 20, y);

    doc.save('KMK-расчёт.pdf');
  }

  function downloadPDF() {
    const text = $('pdfModalText');
    const btn  = $('pdfDownloadBtn');
    text.textContent = 'Расчёт будет сформирован прямо в вашем браузере и скачается автоматически.';
    btn.disabled = false;
    btn.textContent = 'Скачать PDF';
    $('pdfModal').classList.add('visible');
  }

  async function confirmDownload() {
    const btn  = $('pdfDownloadBtn');
    const text = $('pdfModalText');
    btn.disabled = true;
    btn.textContent = 'Формируем...';
    text.textContent = 'Генерируем PDF в браузере — подождите несколько секунд.';

    try {
      await generatePdfClient();
      closeModal('pdfModal');
    } catch (err) {
      text.textContent = `Не удалось сформировать PDF: ${err.message}. Попробуйте позже или позвоните нам.`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Скачать PDF';
    }
  }

  /* ── Navigation ──────────────────────────────────────────── */
  function initStepNavigation() {
    document.querySelectorAll('.step-labels span, .step-dot').forEach(item => {
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('title', 'Перейти к шагу');
      const activate = () => goToStep(parseInt(item.dataset.step, 10));
      item.addEventListener('click', activate);
      item.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });
  }

  /* ── Scroll / section navigation ─────────────────────────── */
  function getSectionScrollTop(id) {
    const target = document.getElementById(id);
    if (!target) return null;
    if (window.matchMedia('(max-width: 900px)').matches) {
      return Math.max(0, target.offsetTop - (id === 'about' ? 0 : 10));
    }
    if (id === 'contacts') return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (['about', 'portfolio', 'calculator', 'services'].includes(id)) return Math.max(0, target.offsetTop);
    return Math.max(0, target.offsetTop + target.offsetHeight / 2 - window.innerHeight / 2);
  }

  function navigateToSection(id, behavior = 'smooth') {
    const top = getSectionScrollTop(id);
    if (top === null) return false;
    window.scrollTo({ top, behavior });
    history.replaceState(null, '', `#${id}`);
    return true;
  }

  function alignSectionToTop(id, behavior = 'smooth') { navigateToSection(id, behavior); }

  function keepCalculatorInView() {
    if (location.hash && location.hash !== '#calculator') return;
    requestAnimationFrame(() => alignSectionToTop('calculator', 'smooth'));
  }

  function initCenteredSectionLinks() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', e => {
        const id = link.getAttribute('href').slice(1);
        if (!document.getElementById(id)) return;
        e.preventDefault();
        navigateToSection(id);
      });
    });
  }

  function alignInitialHashSection() {
    const id = location.hash.slice(1);
    if (!id) return;
    requestAnimationFrame(() => alignSectionToTop(id, 'auto'));
  }

  /* ── Header scroll ───────────────────────────────────────── */
  function initHeaderScroll() {
    const header = $('header');
    window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 20));
  }

  /* ── Mobile menu ─────────────────────────────────────────── */
  function closeMobileMenu() {
    $('mainNav')?.classList.remove('open');
    $('mobileMenuBackdrop')?.classList.remove('visible');
    document.querySelector('.mobile-menu-toggle')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  }

  function initMobileMenu() {
    const nav    = $('mainNav');
    const toggle = document.querySelector('.mobile-menu-toggle');
    const close  = document.querySelector('.mobile-menu-close');
    const backdrop = $('mobileMenuBackdrop');
    if (!nav || !toggle || !backdrop) return;

    const openMenu = () => {
      nav.classList.add('open');
      backdrop.classList.add('visible');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('menu-open');
    };

    toggle.addEventListener('click', () => nav.classList.contains('open') ? closeMobileMenu() : openMenu());
    close?.addEventListener('click', closeMobileMenu);
    backdrop.addEventListener('click', closeMobileMenu);

    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', e => {
        if (window.matchMedia('(max-width: 900px)').matches) {
          const id = link.dataset.section || link.getAttribute('href')?.slice(1);
          if (id && document.getElementById(id)) {
            e.preventDefault();
            nav.querySelectorAll('a').forEach(a => a.classList.remove('active'));
            link.classList.add('active');
            closeMobileMenu();
            setTimeout(() => navigateToSection(id), 40);
          }
          return;
        }
        closeMobileMenu();
      });
    });

    window.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileMenu(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 900) closeMobileMenu(); });
  }

  /* ── Scroll spy ──────────────────────────────────────────── */
  function initScrollSpy() {
    const sections = ['about', 'calculator', 'services', 'portfolio', 'contacts'];
    const navLinks = document.querySelectorAll('#mainNav a');
    const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
    const getRootMargin = () => isMobile() ? '-60px 0px -50% 0px' : '-80px 0px -40% 0px';
    const getThreshold  = () => isMobile() ? 0.15 : 0.3;

    let observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(link => link.classList.toggle('active', link.dataset.section === id));
        }
      });
    }, { threshold: getThreshold(), rootMargin: getRootMargin() });

    sections.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el); });

    let lastIsMobile = isMobile();
    window.addEventListener('resize', () => {
      const now = isMobile();
      if (now === lastIsMobile) return;
      lastIsMobile = now;
      observer.disconnect();
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            navLinks.forEach(link => link.classList.toggle('active', link.dataset.section === id));
          }
        });
      }, { threshold: getThreshold(), rootMargin: getRootMargin() });
      sections.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el); });
    });
  }

  /* ── Counter animation ───────────────────────────────────── */
  function initCounters() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { animateCounter(entry.target); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('.counter').forEach(c => observer.observe(c));
  }

  function animateCounter(el) {
    const target = parseInt(el.dataset.target);
    const duration = 1200;
    const start = performance.now();
    (function update(now) {
      const p = Math.min((now - start) / duration, 1);
      el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 4))).toLocaleString('ru-RU');
      if (p < 1) requestAnimationFrame(update);
      else el.textContent = target.toLocaleString('ru-RU');
    })(start);
  }

  /* ── Parallax ────────────────────────────────────────────── */
  function initParallax() {
    const circles = document.querySelectorAll('.blue-circle');
    let ticking = false;
    let lastY = window.scrollY;
    let impulse = 0;
    let reelImpulse = 0;

    window.kmkPushBackground = (direction = 1) => {
      reelImpulse = direction * 180;
      setTimeout(() => { reelImpulse *= 0.35; }, 180);
      setTimeout(() => { reelImpulse = 0; }, 520);
    };

    window.addEventListener('scroll', () => {
      const currentY = window.scrollY;
      impulse = currentY - lastY;
      lastY = currentY;

      if (!ticking) {
        requestAnimationFrame(() => {
          const y = window.scrollY;
          circles.forEach((c, i) => {
            const dir = i % 2 === 0 ? -1 : 1;
            const pushX = dir * (impulse * 0.28 + reelImpulse * (0.75 + i * 0.08));
            const pushY = -reelImpulse * (0.18 + i * 0.025);
            const xOff  = Math.sin(y * 0.004 + i) * 52 + pushX;
            const yOff  = Math.cos(y * 0.003 + i) * 34 + y * (i + 1) * 0.018 + pushY;
            const scale = 1 + Math.min((Math.abs(impulse) + Math.abs(reelImpulse)) / 1200, 0.14);
            c.style.transform = `translate3d(${xOff}px, ${yOff}px, 0) scale(${scale})`;
          });
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  /* ── Section reveal ──────────────────────────────────────── */
  function initSectionReveal() {
    const targets = document.querySelectorAll('.site, .portfolio, .footer');
    targets.forEach(s => s.classList.add('reveal-section'));
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => e.target.classList.toggle('visible', e.isIntersecting));
    }, { threshold: 0.04, rootMargin: '-6% 0px -14% 0px' });
    targets.forEach(s => obs.observe(s));
  }

  /* ── Reel scroll (snap between sections) ─────────────────── */
  function getReelSections() {
    return ['about', 'calculator', 'services', 'portfolio', 'contacts']
      .map(id => document.getElementById(id)).filter(Boolean);
  }

  function getCurrentReelIndex() {
    const sections = getReelSections();
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (window.scrollY >= maxScroll - 8) return sections.length - 1;
    const marker = window.scrollY + window.innerHeight * 0.42;
    let index = 0;
    sections.forEach((s, i) => { if (s.offsetTop <= marker) index = i; });
    return index;
  }

  function canScrollInsideElement(start, deltaY) {
    let node = start;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.classList?.contains('gallery-overlay')) return true;
      const style = getComputedStyle(node);
      const canScroll = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2;
      if (canScroll) {
        const atTop = node.scrollTop <= 0;
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 2;
        if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function initReelScroll() {
    const sections = getReelSections();
    if (!sections.length) return;

    const mq = window.matchMedia('(max-width: 900px)');
    let animating = false;
    let wheelDelta = 0;
    let touchStartY = 0;
    let touchLocked = false;
    let active = false;

    const isFormControl = t => Boolean(t.closest?.('input, select, textarea, [contenteditable="true"]'));
    const clampIndex = i => Math.max(0, Math.min(sections.length - 1, i));
    const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const smoothScrollTo = (top, duration = 720) => {
      const start = window.scrollY;
      const distance = top - start;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(distance) < 2) {
        window.scrollTo({ top, behavior: 'auto' });
        return Promise.resolve();
      }
      return new Promise(resolve => {
        const startedAt = performance.now();
        (function step(now) {
          const p = Math.min((now - startedAt) / duration, 1);
          window.scrollTo({ top: start + distance * easeInOutCubic(p), behavior: 'auto' });
          if (p < 1) requestAnimationFrame(step);
          else { window.scrollTo({ top, behavior: 'auto' }); resolve(); }
        })(startedAt);
      });
    };

    const goToIndex = async (index, direction) => {
      if (!active || animating || document.body.style.overflow === 'hidden') return;
      const targetIndex = clampIndex(index);
      const target = sections[targetIndex];
      if (!target) return;
      const currentIndex = getCurrentReelIndex();
      if (targetIndex === currentIndex && Math.abs(window.scrollY - (getSectionScrollTop(target.id) ?? 0)) < 20) {
        wheelDelta = 0;
        return;
      }
      animating = true;
      wheelDelta = 0;
      history.replaceState(null, '', `#${target.id}`);
      window.kmkPushBackground?.(direction);
      await smoothScrollTo(getSectionScrollTop(target.id) ?? target.offsetTop);
      animating = false;
    };

    const goByDirection = dir => goToIndex(getCurrentReelIndex() + dir, dir);

    function onWheel(e) {
      if (!active) return;
      const dy = e.deltaY;
      if (Math.abs(dy) < 10 || document.body.style.overflow === 'hidden') return;
      if (isFormControl(e.target) || canScrollInsideElement(e.target, dy)) return;
      e.preventDefault();
      if (animating) return;
      wheelDelta += dy;
      if (Math.abs(wheelDelta) < 28) return;
      goByDirection(wheelDelta > 0 ? 1 : -1);
    }

    function onTouchStart(e) {
      if (!active) return;
      touchStartY = e.touches[0]?.clientY || 0;
      touchLocked = false;
    }

    function onTouchMove(e) {
      if (!active) return;
      const currentY = e.touches[0]?.clientY || 0;
      const dy = touchStartY - currentY;
      if (touchLocked || Math.abs(dy) < 42) return;
      if (!canScrollInsideElement(e.target, dy)) return;
      e.preventDefault();
      touchLocked = true;
      goByDirection(dy > 0 ? 1 : -1);
    }

    function onKeyDown(e) {
      if (!active) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag) || document.activeElement?.isContentEditable) return;
      if (['ArrowDown', 'PageDown', 'Space'].includes(e.code)) { e.preventDefault(); goByDirection(1); }
      if (['ArrowUp', 'PageUp'].includes(e.code))               { e.preventDefault(); goByDirection(-1); }
    }

    function attach() {
      if (active) return;
      active = true;
      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('keydown', onKeyDown);
    }

    function detach() {
      if (!active) return;
      active = false;
      animating = false;
      wheelDelta = 0;
      touchLocked = false;
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKeyDown);
    }

    function syncMode() { mq.matches ? detach() : attach(); }
    syncMode();
    mq.addEventListener('change', syncMode);
  }

  /* ── Boot ────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    syncServicePrices();
    initSegmented();
    initCleaningTypes();
    initServices();
    initDateTime();
    attachPhoneMask($('phone'));
    attachPhoneMask($('callbackPhone'));
    initAddressSuggest();
    initStepNavigation();
    initConsentControls();
    initCookieConsent();
    updateUI();
    initCounters();
    initParallax();
    initScrollSpy();
    initHeaderScroll();
    initMobileMenu();
    initCenteredSectionLinks();
    initSectionReveal();
    initReelScroll();
    alignInitialHashSection();
  });

  /* ── Expose to inline handlers ───────────────────────────── */
  Object.assign(window, {
    nextStep, prevStep, confirmOrder, confirmDownload,
    downloadPDF, applyPromo, submitCallback,
    openCalculatorFromService, filterWorks, openGallery, closeGallery,
    openCookieSettings, saveCookieConsent, saveCookieSettings, closeModal,
  });
})();
