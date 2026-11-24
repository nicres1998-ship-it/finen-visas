const base = 'https://upbcsdocsoicujeylpmx.supabase.co';
const key = 'sb_publishable_wOqfHlkJATss_6Ow_6jgaw_GepOkl6s';
import { labels, MASTER, readFicha, replaceQr, verifier } from './admin-pdf.mjs';

const byId = id => document.getElementById(id);
const login = byId('login');
const pdf = byId('pdf');
const issue = byId('issue');
const download = byId('download');
const pageSize = 25;
let session;
let ficha;
let downloadUrl;
let page = 0;
let historyRequest = 0;

async function request(path, body, auth = session) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + auth;
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && auth && auth === session) reset();
    throw Error(result.message || result.msg || 'No fue posible completar la consulta.');
  }
  return result;
}
const rpc = (name, body = {}) => request('/rest/v1/rpc/' + name, body);

function message(text, error = false) {
  const status = byId('message');
  status.textContent = text;
  status.toggleAttribute('data-error', error);
}

function clearFicha() {
  ficha = undefined;
  issue.disabled = true;
  const fields = byId('fields');
  fields.replaceChildren();
  fields.hidden = true;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  download.removeAttribute('href');
  download.hidden = true;
}

function reset() {
  session = undefined;
  historyRequest++;
  page = 0;
  pdf.value = '';
  clearFicha();
  byId('history').replaceChildren();
  byId('search').value = '';
  byId('panel').hidden = true;
  byId('logout').hidden = true;
  login.hidden = false;
}

login.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  message('Comprobando acceso…');
  try {
    const result = await request('/auth/v1/token?grant_type=password', {
      email: login.elements.email.value.trim(), password: login.elements.password.value
    });
    if (!result.access_token || await request('/rest/v1/rpc/finen_rol_actual', {}, result.access_token) !== 'ADMIN') {
      throw Error('Acceso reservado a administración.');
    }
    session = result.access_token;
    login.hidden = true;
    byId('logout').hidden = false;
    byId('panel').hidden = false;
    message('');
    await loadHistory();
  } catch (error) {
    reset();
    message(error.message, true);
  } finally {
    login.elements.password.value = '';
    button.disabled = false;
  }
});

byId('logout').addEventListener('click', () => {
  const auth = session;
  reset();
  message('Sesión cerrada.');
  request('/auth/v1/logout', {}, auth).catch(() => {});
});

pdf.addEventListener('change', async () => {
  clearFicha();
  const file = pdf.files[0];
  const auth = session;
  if (!file || !auth) return;
  message('Leyendo campos de la ficha…');
  try {
    if (file.size > 25 * 1024 * 1024) throw Error('La ficha supera 25 MB.');
    const parsed = await readFicha(await file.arrayBuffer());
    if (auth !== session || pdf.files[0] !== file) return;
    const fields = byId('fields');
    for (const [name, label] of Object.entries(labels)) {
      const entry = document.createElement('div');
      const term = document.createElement('dt');
      const value = document.createElement('dd');
      term.textContent = label;
      value.textContent = parsed.fields[name] || '—';
      entry.append(term, value);
      fields.append(entry);
    }
    fields.hidden = false;
    message('');
    ficha = { ...parsed, token: crypto.randomUUID().replaceAll('-', '') };
    issue.disabled = false;
  } catch (error) {
    if (auth === session && pdf.files[0] === file) message(error.message, true);
  }
});

issue.addEventListener('click', async () => {
  const current = ficha;
  const auth = session;
  if (!current || !auth) return;
  issue.disabled = true;
  pdf.disabled = true;
  let completed = false;
  message('Preparando PDF y registrando la referencia…');
  try {
    let bytes = await replaceQr(current, window.qrcode, current.token);
    if (auth !== session) return;
    const row = await rpc('finen_registrar_ficha_pdf', {
      p_plantilla_sha256: MASTER,
      p_pdf_sha256: current.hash,
      p_campos: current.fields,
      p_fecha_emision: current.issue,
      p_fecha_vencimiento: current.due,
      p_importe: current.amount,
      p_token_qr: current.token
    });
    if (auth !== session) return;
    if (row?.folio !== current.fields.folio || !/^[A-Za-z0-9_-]{24,128}$/.test(row?.token_qr ?? '')) {
      throw Error('El servidor devolvió una referencia que no coincide con la ficha.');
    }
    if (row.token_qr !== current.token) bytes = await replaceQr(current, window.qrcode, row.token_qr);
    if (auth !== session) return;
    downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    download.href = downloadUrl;
    download.download = row.folio + '.pdf';
    download.hidden = false;
    completed = true;
    message('Referencia registrada. El PDF definitivo está listo para descargar.');
    await loadHistory();
  } catch (error) {
    if (auth === session) message(error.message, true);
  } finally {
    pdf.disabled = false;
    issue.disabled = completed || ficha !== current;
  }
});

async function loadHistory() {
  const auth = session;
  if (!auth) return;
  const sequence = ++historyRequest;
  const params = new URLSearchParams({
    select: 'id,folio,cliente,importe,estatus,token_qr',
    order: 'folio.desc,id.desc',
    offset: String(page * pageSize),
    limit: String(pageSize + 1)
  });
  const term = byId('search').value.trim().replace(/[%_*,.()"\\]/g, '').trim();
  if (term) params.set('or', '(folio.ilike.*' + term + '*,cliente.ilike.*' + term + '*)');
  try {
    const rows = await request('/rest/v1/finen_referencias?' + params);
    if (sequence !== historyRequest || auth !== session) return;
    byId('history').replaceChildren(...rows.slice(0, pageSize).map(renderRow));
    byId('prev').disabled = page === 0;
    byId('next').disabled = rows.length <= pageSize;
    byId('page-number').textContent = rows.length ? 'Página ' + (page + 1) : 'Sin resultados';
  } catch (error) {
    if (sequence === historyRequest) message(error.message, true);
  }
}

function renderRow(row) {
  const tr = document.createElement('tr');
  for (const value of [row.folio, row.cliente, row.importe, row.estatus]) {
    tr.insertCell().textContent = value ?? '—';
  }
  const actions = document.createElement('div');
  actions.className = 'actions';
  tr.insertCell().append(actions);
  if (row.token_qr) {
    const link = document.createElement('a');
    link.href = verifier(row.token_qr);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Verificar';
    actions.append(link);
  }
  if (row.estatus === 'PENDIENTE') {
    for (const [status, label] of [['PAGADA', 'Confirmar pago'], ['CANCELADA', 'Cancelar referencia']]) {
      const button = document.createElement('button');
      button.className = 'secondary';
      button.textContent = label;
      button.onclick = async () => {
        if (!confirm(label + ' · ' + row.folio + ' ¿Continuar?')) return;
        const reason = status === 'CANCELADA' ? prompt('Motivo de cancelación')?.trim() : null;
        if (status === 'CANCELADA' && !reason) return;
        const buttons = [...actions.querySelectorAll('button')];
        buttons.forEach(control => { control.disabled = true; });
        try {
          await rpc('finen_cambiar_estatus', { p_id: row.id, p_estatus: status, p_motivo: reason });
          message('Estatus actualizado a ' + status + '.');
          await loadHistory();
        } catch (error) {
          message(error.message, true);
          buttons.forEach(control => { control.disabled = false; });
        }
      };
      actions.append(button);
    }
  }
  return tr;
}

byId('refresh').onclick = () => { page = 0; loadHistory(); };
byId('search').addEventListener('keydown', event => {
  if (event.key === 'Enter') byId('refresh').click();
});
byId('prev').onclick = () => { page--; loadHistory(); };
byId('next').onclick = () => { page++; loadHistory(); };
