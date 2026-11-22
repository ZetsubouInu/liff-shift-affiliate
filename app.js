/**
 * シフト提出 LIFF 本体（全店舗共通）
 * 店舗ごとの値（LIFF ID・GASのURL）は stores/<店舗>/index.html の window.SHIFT_CONFIG に書く。
 * URLの末尾に ?mock=1 を付けると、LINEとGASにつながずに画面だけ確認できる（見た目の確認用）。
 */
(function () {
  'use strict';

  const CFG = window.SHIFT_CONFIG || {};
  const MOCK = new URLSearchParams(location.search).has('mock');
  const NAME_KEY = 'shift_name_' + (CFG.liffId || 'local');
  const DRAFT_PREFIX = 'shift_draft_' + (CFG.liffId || 'local') + '_';

  const state = { name: null, config: null, tab: 'submit' };
  const $ = (s, root) => (root || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------
  // 保存（LINEのブラウザで使えない場合に備えて try で囲む）
  // ------------------------------------------------------------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても続行 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } },
  };

  // ------------------------------------------------------------
  // 通信
  // ------------------------------------------------------------
  async function api(action, data) {
    if (MOCK) return mockApi(action, data || {});
    let idToken = null;
    try { idToken = window.liff && liff.getIDToken(); } catch (e) { /* noop */ }
    const res = await fetch(CFG.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action, idToken: idToken }, data || {})),
    });
    if (!res.ok) throw new Error('通信に失敗しました（' + res.status + '）');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'エラーが発生しました');
    return json;
  }

  // ------------------------------------------------------------
  // 画面の部品
  // ------------------------------------------------------------
  function loading(on, text) {
    const el = $('#loading');
    el.classList.toggle('hidden', !on);
    $('#loading-text').textContent = text || '読み込み中…';
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  /** 下から出るダイアログ。buttons: [{label, kind:'primary'|'secondary', value}] → 押されたvalueを返す */
  function dialog(title, bodyHtml, buttons) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML =
        '<div class="sheet"><h3>' + esc(title) + '</h3><div class="body">' + bodyHtml + '</div><div class="actions">' +
        buttons.map((b, i) => '<button class="btn ' + (b.kind || 'secondary') + '" data-i="' + i + '">' + esc(b.label) + '</button>').join('') +
        '</div></div>';
      ov.addEventListener('click', e => {
        const i = e.target.getAttribute('data-i');
        if (i !== null) { ov.remove(); resolve(buttons[Number(i)].value); }
        else if (e.target === ov) { ov.remove(); resolve(null); }
      });
      document.body.appendChild(ov);
    });
  }

  async function showError(err) {
    loading(false);
    await dialog('うまくいきませんでした', esc(err && err.message || err), [{ label: '閉じる', kind: 'primary', value: true }]);
  }

  // ------------------------------------------------------------
  // 源氏名の登録（初期設定・変更で共通）
  // ------------------------------------------------------------
  async function registerName(name) {
    loading(true, '確認中…');
    let res = await api('registerName', { name: name });
    loading(false);
    if (res.status === 'exists') {
      const yes = await dialog('この名前は登録済みです',
        '「' + esc(res.name) + '」はすでに名簿にあります。<br>あなた本人ですか？<br><span class="meta">別の人と同じ名前の場合は「いいえ」を押して、名前を変えてください。</span>',
        [{ label: 'はい、本人です', kind: 'primary', value: true }, { label: 'いいえ（名前を変える）', value: false }]);
      if (!yes) return null;
      loading(true, '登録中…');
      res = await api('registerName', { name: name, confirmed: true });
      loading(false);
    }
    return res.name;
  }

  function renderSetup() {
    $('#view-setup').classList.remove('hidden');
    $('#view-main').classList.add('hidden');
    $('#setup-store').textContent = CFG.storeName || '';
    $('#setup-form').onsubmit = async e => {
      e.preventDefault();
      const name = $('#setup-name').value.trim();
      if (!name) { toast('源氏名を入力してください'); return; }
      try {
        const saved = await registerName(name);
        if (!saved) return;
        state.name = saved;
        store.set(NAME_KEY, saved);
        await startMain();
      } catch (err) { showError(err); }
    };
  }

  async function renameFlow() {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML =
      '<div class="sheet"><h3>源氏名の変更</h3><div class="body">' +
      '<input type="text" id="rename-input" maxlength="20" placeholder="新しい源氏名" value="' + esc(state.name) + '">' +
      '<p class="meta">これまでに提出したシフトは前の名前のまま残ります。必要なら内勤さんに連絡してください。</p>' +
      '</div><div class="actions"><button class="btn primary" id="rename-ok">変更する</button><button class="btn secondary" id="rename-cancel">やめる</button></div></div>';
    document.body.appendChild(ov);
    $('#rename-cancel', ov).onclick = () => ov.remove();
    $('#rename-ok', ov).onclick = async () => {
      const name = $('#rename-input', ov).value.trim();
      if (!name) { toast('源氏名を入力してください'); return; }
      if (name === state.name) { ov.remove(); return; }
      ov.remove();
      try {
        const saved = await registerName(name);
        if (!saved) return;
        state.name = saved;
        store.set(NAME_KEY, saved);
        toast('源氏名を「' + saved + '」に変更しました');
        await startMain();
      } catch (err) { showError(err); }
    };
  }

  // ------------------------------------------------------------
  // メイン画面
  // ------------------------------------------------------------
  async function startMain() {
    $('#view-setup').classList.add('hidden');
    $('#view-main').classList.remove('hidden');
    $('#store-name').textContent = (CFG.storeName || state.config && state.config.storeName || '') + ' シフト提出';
    $('#user-name').textContent = state.name;
    $('#rename-btn').onclick = renameFlow;
    document.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => { state.tab = t.dataset.tab; switchTab(); };
    });
    await switchTab();
  }

  async function switchTab() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
    if (state.tab === 'submit') await loadSubmit();
    else await loadStatus();
  }

  // ---------- 提出タブ ----------
  async function loadSubmit() {
    const box = $('#content');
    box.innerHTML = '';
    try {
      loading(true);
      state.config = await api('getConfig', { name: state.name });
      loading(false);
    } catch (err) { return showError(err); }
    if (!$('#store-name').textContent.trim() || $('#store-name').textContent === ' シフト提出') {
      $('#store-name').textContent = (state.config.storeName || '') + ' シフト提出';
    }

    const periods = state.config.periods;
    if (!periods.length) {
      box.innerHTML = '<div class="empty">いま受付中の期間はありません。</div>';
      return;
    }
    // 未提出の期間を上に
    const open = periods.filter(p => !p.submitted);
    const done = periods.filter(p => p.submitted);
    done.forEach(p => {
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = '<h2>' + esc(p.label) + '<span class="badge ok">提出済み</span></h2>' +
        '<div class="meta">内容は「提出状況」タブで確認できます。修正はシフト用LINEのトークで連絡してください。</div>';
      box.appendChild(c);
    });
    open.forEach(p => box.appendChild(renderPeriodForm(p)));
  }

  function draftKey(p) { return DRAFT_PREFIX + state.name + '_' + p.start; }

  function renderPeriodForm(p) {
    const card = document.createElement('div');
    card.className = 'card';
    const draft = JSON.parse(store.get(draftKey(p)) || '{}');
    const so = state.config.startOptions;
    const eo = state.config.endOptions;
    const opt = (list, sel) => list.map(v => '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>').join('');

    const late = p.isLate
      ? '<div class="notice warn">提出期限（' + esc(p.deadlineLabel) + '）を過ぎています。' + esc(p.hardCloseLabel) + 'までに提出してください。</div>'
      : '';

    card.innerHTML =
      '<h2>' + esc(p.label) + '<span class="badge ' + (p.isLate ? 'warn' : 'none') + '">' + (p.isLate ? '期限超過' : '未提出') + '</span></h2>' +
      '<div class="meta">提出期限 ' + esc(p.deadlineLabel) + '　／　締切 ' + esc(p.hardCloseLabel) + '</div>' + late +
      '<details class="bulk"><summary>まとめて入力する</summary><div class="bulk-body">' +
      '<div class="wd">' + ['日', '月', '火', '水', '木', '金', '土'].map((w, i) => '<label><input type="checkbox" value="' + i + '" checked>' + w + '</label>').join('') + '</div>' +
      '<select class="b-start">' + opt(so, so[1]) + '</select><select class="b-end">' + opt(eo, eo[1]) + '</select>' +
      '<button type="button" class="btn secondary b-apply">チェックした曜日に反映</button></div></details>' +
      '<div class="col-head"><span></span><span>出勤</span><span>退勤</span></div>' +
      '<div class="day-list">' +
      p.days.map(d => {
        if (d.holiday) {
          return '<div class="day closed"><span class="date w' + d.weekday + '">' + esc(d.label) + '</span><span class="closed-label">店休日</span></div>';
        }
        const v = draft[d.date] || { start: '休み', end: '休み' };
        return '<div class="day" data-date="' + d.date + '" data-w="' + d.weekday + '">' +
          '<span class="date w' + d.weekday + '">' + esc(d.label) + '</span>' +
          '<select class="s-start">' + opt(so, v.start) + '</select>' +
          '<select class="s-end">' + opt(eo, v.end) + '</select></div>';
      }).join('') +
      '</div>' +
      '<button type="button" class="btn primary go-confirm" style="margin-top:14px">内容を確認して提出</button>';

    const refresh = () => {
      const data = {};
      card.querySelectorAll('.day[data-date]').forEach(row => {
        const s = $('.s-start', row), e = $('.s-end', row);
        s.classList.toggle('set', s.value !== '休み');
        e.classList.toggle('set', e.value !== '休み');
        row.classList.toggle('working', s.value !== '休み' || e.value !== '休み');
        data[row.dataset.date] = { start: s.value, end: e.value };
      });
      store.set(draftKey(p), JSON.stringify(data));
      return data;
    };
    card.addEventListener('change', e => { if (e.target.matches('.s-start, .s-end')) refresh(); });

    $('.b-apply', card).onclick = () => {
      const days = Array.from(card.querySelectorAll('.wd input:checked')).map(i => i.value);
      const bs = $('.b-start', card).value, be = $('.b-end', card).value;
      card.querySelectorAll('.day[data-date]').forEach(row => {
        if (days.indexOf(row.dataset.w) >= 0) { $('.s-start', row).value = bs; $('.s-end', row).value = be; }
      });
      refresh();
      toast('反映しました');
    };

    $('.go-confirm', card).onclick = () => confirmAndSubmit(p, refresh());
    refresh();
    return card;
  }

  async function confirmAndSubmit(p, data) {
    const label = d => p.days.find(x => x.date === d).label;
    const working = Object.keys(data).filter(d => data[d].start !== '休み' || data[d].end !== '休み');
    const show = v => v === '休み' ? '—' : v;
    const body = working.length
      ? '<div class="confirm-list">' + working.map(d =>
          '<div class="shift-line"><span>' + esc(label(d)) + '</span><span class="time">' + esc(show(data[d].start)) + ' 〜 ' + esc(show(data[d].end)) + '</span></div>').join('') +
        '</div><div class="meta">出勤 ' + working.length + '日。そのほかの日は休みで提出します。</div>'
      : '<div class="notice info">全部「休み」で提出します。</div>';
    const ok = await dialog(p.label + ' の提出', body + '<p class="meta" style="margin-top:12px">提出は1回だけです。提出後の修正はシフト用LINEのトークで連絡してください。</p>',
      [{ label: 'この内容で提出する', kind: 'primary', value: true }, { label: '戻って直す', value: false }]);
    if (!ok) return;
    try {
      loading(true, '送信中…');
      const shifts = Object.keys(data).map(d => ({ date: d, start: data[d].start, end: data[d].end }));
      const res = await api('submit', { name: state.name, periodStart: p.start, shifts: shifts });
      loading(false);
      store.del(draftKey(p));
      await dialog('提出しました', esc(res.message), [{ label: 'OK', kind: 'primary', value: true }]);
      await loadSubmit();
    } catch (err) { showError(err); }
  }

  // ---------- 提出状況タブ ----------
  async function loadStatus() {
    const box = $('#content');
    box.innerHTML = '';
    let res;
    try {
      loading(true);
      res = await api('getStatus', { name: state.name });
      loading(false);
    } catch (err) { return showError(err); }
    if (!res.periods.length) { box.innerHTML = '<div class="empty">表示できる期間がありません。</div>'; return; }
    const show = v => v === '' ? '—' : v;
    res.periods.slice().reverse().forEach(p => {
      const c = document.createElement('div');
      c.className = 'card';
      const badge = p.allOff ? '<span class="badge ok">全部休み</span>'
        : p.submitted ? '<span class="badge ok">提出済み</span>' : '<span class="badge none">未提出</span>';
      let inner = '';
      if (p.shifts.length) {
        inner = '<div style="margin-top:8px">' + p.shifts.map(s =>
          '<div class="shift-line"><span>' + esc(s.label) + '</span><span class="time">' + esc(show(s.start)) + ' 〜 ' + esc(show(s.end)) + '</span></div>').join('') + '</div>';
      } else if (p.allOff) {
        inner = '<div class="meta">この期間は全部休みで提出しています。</div>';
      } else {
        inner = '<div class="meta">提出されたシフトはありません。</div>';
      }
      c.innerHTML = '<h2>' + esc(p.label) + badge + '</h2>' + inner;
      box.appendChild(c);
    });
    const note = document.createElement('div');
    note.className = 'meta';
    note.style.textAlign = 'center';
    note.textContent = '内勤さんが修正した内容もここに反映されます。';
    box.appendChild(note);
  }

  // ------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------
  async function boot() {
    try {
      if (!MOCK) {
        if (!window.liff) throw new Error('LINEの読み込みに失敗しました。開き直してください');
        await liff.init({ liffId: CFG.liffId });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
      }
      loading(false);
      state.name = store.get(NAME_KEY);
      if (state.name) await startMain();
      else renderSetup();
    } catch (err) {
      showError(err);
    }
  }

  // ------------------------------------------------------------
  // 見た目の確認用（?mock=1）：GASの代わりにブラウザ内で動く
  // ------------------------------------------------------------
  const mockDb = { roster: ['あい', 'まふゆ'], subs: {} };
  function mockApi(action, d) {
    const W = ['日', '月', '火', '水', '木', '金', '土'];
    const pad = n => ('0' + n).slice(-2);
    const ymd = x => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
    const md = x => (x.getMonth() + 1) + '/' + x.getDate();
    const mdw = x => md(x) + '(' + W[x.getDay()] + ')';
    const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate() <= 15 ? 1 : 16);
    const endOf = s => s.getDate() === 1 ? new Date(s.getFullYear(), s.getMonth(), 15) : new Date(s.getFullYear(), s.getMonth() + 1, 0);
    const next = s => s.getDate() === 1 ? new Date(s.getFullYear(), s.getMonth(), 16) : new Date(s.getFullYear(), s.getMonth() + 1, 1);
    const add = (x, n) => new Date(x.getFullYear(), x.getMonth(), x.getDate() + n);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const times = []; for (let m = 17 * 60; m <= 28 * 60 + 30; m += 30) times.push(pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60));
    return new Promise(resolve => setTimeout(() => {
      if (action === 'registerName') {
        if (mockDb.roster.indexOf(d.name) >= 0 && !d.confirmed) return resolve({ ok: true, status: 'exists', name: d.name });
        if (mockDb.roster.indexOf(d.name) < 0) mockDb.roster.push(d.name);
        return resolve({ ok: true, status: 'registered', name: d.name });
      }
      if (action === 'getConfig') {
        const periods = [];
        for (let s = startOf(today), i = 0; i < 4; s = next(s), i++) {
          const hc = add(s, -3), dl = add(s, -5);
          if (today > hc) continue;
          const days = [];
          for (let x = s; x <= endOf(s); x = add(x, 1)) days.push({ date: ymd(x), label: mdw(x), weekday: x.getDay(), holiday: x.getDay() === 1 });
          periods.push({ start: ymd(s), label: md(s) + '〜' + md(endOf(s)), deadlineLabel: mdw(dl), hardCloseLabel: mdw(hc), isLate: today > dl,
            submitted: !!mockDb.subs[d.name + s.getTime()], days: days });
          if (periods.length >= 2) break;
        }
        return resolve({ ok: true, storeName: 'サンプル店', startOptions: ['休み'].concat(times), endOptions: ['休み', 'LAST'].concat(times), periods: periods });
      }
      if (action === 'submit') {
        const s = new Date(d.periodStart.replace(/-/g, '/'));
        mockDb.subs[d.name + s.getTime()] = d.shifts.filter(x => x.start !== '休み' || x.end !== '休み');
        const n = mockDb.subs[d.name + s.getTime()].length;
        return resolve({ ok: true, message: md(s) + '〜' + md(endOf(s)) + (n ? ' のシフトを提出しました（' + n + '日）' : ' を全部休みで提出しました') });
      }
      if (action === 'getStatus') {
        const periods = [];
        for (let s = new Date(today.getFullYear(), today.getMonth(), 1), i = 0; i < 4; s = next(s), i++) {
          const sub = mockDb.subs[d.name + s.getTime()];
          periods.push({ start: ymd(s), label: md(s) + '〜' + md(endOf(s)), submitted: !!sub, allOff: !!sub && !sub.length,
            shifts: (sub || []).map(x => ({ date: x.date, label: mdw(new Date(x.date.replace(/-/g, '/'))), start: x.start === '休み' ? '' : x.start, end: x.end === '休み' ? '' : (x.end === 'LAST' ? 'L' : x.end) })) });
        }
        return resolve({ ok: true, name: d.name, periods: periods });
      }
      resolve({ ok: false, error: 'unknown' });
    }, 250));
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
