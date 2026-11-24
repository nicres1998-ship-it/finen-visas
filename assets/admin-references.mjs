const base = 'https://upbcsdocsoicujeylpmx.supabase.co';
const key = 'sb_publishable_wOqfHlkJATss_6Ow_6jgaw_GepOkl6s';
import { labels, MASTER, readFicha, prepareDeliveryPdf, verifier, validateFields, sha256, fillMaster, validateMaster } from './admin-pdf.mjs?v=expediente1';

import { localMaster } from './admin-template.mjs';

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

const verifyLink = byId('verify-link');
let draft;
const editor = byId('editor');
const draftForm = byId('draft-form');
const newReference = byId('new-reference');
const templatePicker = byId('template');
let masterBytes;
let preparingDraft = false;
const requiredFields = new Set(['folio', 'fecha', 'vence', 'contrato', 'nombre', 'concepto', 'importe', 'letra']);
for (const [name, label] of Object.entries(labels)) {
  if (name === 'folio_pie') continue;
  const entry = document.createElement('label');
  entry.textContent = label;
  const input = document.createElement('input');
  input.name = name;
  input.maxLength = name === 'folio' ? 24 : 200;
  input.required = requiredFields.has(name);
  if (name === 'fecha' || name === 'vence') input.type = 'date';
  if (name === 'folio') input.pattern = 'RP-[0-9]{4}-[0-9]{1,16}';
  if (name === 'importe') input.inputMode = 'decimal';
  entry.append(input);
  byId('draft-fields').append(entry);
}
function today() {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
}
draftForm.elements.fecha.value = today();
byId('open-login').onclick = () => {
  editor.hidden = true;
  login.hidden = false;
  login.elements.email.focus();
};

function templateState() {
  byId('template-status').textContent = masterBytes
    ? 'Plantilla disponible en este navegador.'
    : 'Selecciona la ficha maestra una vez. El archivo se guarda solo en este navegador.';
  if (draft && !masterBytes) byId('template-settings').open = true;
}

templatePicker.addEventListener('change', async () => {
  try {
    const file = templatePicker.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) throw Error('La ficha maestra supera 25 MB.');
    const bytes = await file.arrayBuffer();
    await validateMaster(bytes);
    await localMaster(bytes);
    masterBytes = bytes;
    templateState();
    byId('template-settings').open = false;
    if (draft && session) await prepareDraft();
  } catch (error) {
    message(error.message, true);
  } finally { templatePicker.value = ''; }
});

async function prepareDraft() {
  if (!draft || !session || preparingDraft) return;
  preparingDraft = true;
  try {
    const current = draft;
    const auth = session;
    const hash = await sha256(new TextEncoder().encode('FINEN:maestro:v1:' + JSON.stringify(current.fields)));
    if (auth !== session || current !== draft) return;
    preview({ ...current, hash, fromDraft: true });
    templateState();
    issue.disabled = !masterBytes;
    message(masterBytes ? 'Revisa los datos y pulsa «Registrar ficha».' : 'Configura la ficha maestra para preparar la copia del cliente.');
  } finally { preparingDraft = false; }
}

draftForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const fields = Object.fromEntries(Object.keys(labels).map(key => {
      const value = draftForm.elements[key === 'folio_pie' ? 'folio' : key].value.trim();
      return [key, key === 'fecha' || key === 'vence' ? value.split('-').reverse().join('/') : value];
    }));
    draft = validateFields(fields);
    editor.hidden = true;
    login.hidden = Boolean(session);
    if (session) {
      clearFicha();
      await prepareDraft();
    } else {
      message('Los datos están listos. Inicia sesión para revisarlos y registrar la ficha.');
      login.elements.email.focus();
    }
  } catch (error) { message(error.message, true); }
});

newReference.addEventListener('click', () => {
  const registeredFolio = ficha?.fields.folio ?? '';
  const parts = /^(RP-\d{4}-)(\d+)$/.exec(registeredFolio);
  clearFicha();
  draft = undefined;
  draftForm.reset();
  if (parts) draftForm.elements.folio.value = parts[1] + String(BigInt(parts[2]) + 1n).padStart(parts[2].length, '0');
  draftForm.elements.fecha.value = today();
  editor.hidden = false;
  editor.scrollIntoView({ block: 'start' });
  draftForm.elements.folio.focus();
  message('');
});

const incoming = new URLSearchParams(location.hash.slice(1)).get('registrar');
if (incoming !== null) {
  history.replaceState(history.state, '', location.pathname + location.search);
  try {
    if (incoming.length > 4500) throw Error('Datos demasiado largos');
    const source = JSON.parse(incoming);
    const fields = Object.fromEntries(Object.keys(labels).map(name => {
      const value = source?.[name];
      if (typeof value !== 'string' || value.length > 350) throw Error('Datos incompletos');
      return [name, value];
    }));
    draft = validateFields(fields);
    editor.hidden = true;
    login.hidden = false;
    message('Ficha recibida desde el PDF. Inicia sesión para confirmar el registro.');
  } catch {
    message('No se pudieron leer los datos del PDF. Abre la ficha y pulsa «Registrar ficha en FINEN» de nuevo.', true);
  }
}

function preview(parsed) {
  const fields = byId('fields');
  fields.replaceChildren();
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
  ficha = { ...parsed, token: crypto.randomUUID().replaceAll('-', '') };
  issue.textContent = 'Registrar ficha';
  issue.disabled = false;
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
  verifyLink.hidden = true;
  verifyLink.removeAttribute('href');
  newReference.hidden = true;
}

function reset() {
  session = undefined;
  byId('open-login').hidden = false;
  historyRequest++;
  page = 0;
  pdf.value = '';
  clearFicha();
  byId('history').replaceChildren();
  byId('search').value = '';
  byId('panel').hidden = true;
  byId('logout').hidden = true;
  login.hidden = !draft;
  editor.hidden = Boolean(draft);
  if (!draft) { draftForm.reset(); draftForm.elements.fecha.value = today(); }
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
    byId('open-login').hidden = true;
    login.hidden = true;
    byId('logout').hidden = false;
    byId('panel').hidden = false;
    message('');
    try { masterBytes = await localMaster(); } catch { masterBytes = undefined; }
    templateState();
    await prepareDraft();
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
  draft = undefined;
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
    draft = undefined;
    preview(parsed);
    message('');
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
  message(current.bytes ? 'Preparando PDF y registrando la referencia…' : 'Registrando la referencia…');
  try {
    const prepared = current.fromDraft ? { ...current, ...await fillMaster(masterBytes, current.fields) } : current;
    let bytes = await prepareDeliveryPdf(prepared, current.token);
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
    if (bytes && row.token_qr !== current.token) bytes = await prepareDeliveryPdf(prepared, row.token_qr);
    if (auth !== session) return;
    if (bytes) {
      downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      download.href = downloadUrl;
      download.download = row.folio + '.pdf';
      download.hidden = false;
    }
    verifyLink.href = verifier(row.token_qr, row.folio);
    verifyLink.hidden = false;
    completed = true;
    newReference.hidden = false;
    draft = undefined;
    message('Referencia registrada. Usa «Guardar copia» para descargar el PDF del cliente.');
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
    link.href = verifier(row.token_qr, row.folio);
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
