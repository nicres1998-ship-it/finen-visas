const base = 'https://upbcsdocsoicujeylpmx.supabase.co';
const key = 'sb_publishable_wOqfHlkJATss_6Ow_6jgaw_GepOkl6s';
import { labels, MASTER, readFicha, verifier, validateFields, sha256, fillMaster, validateMaster } from './admin-pdf.mjs?v=copiaregistro1';

import { localMaster, localCopy } from './admin-template.mjs?v=expedientes2';

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
const editorCopy = byId('editor-copy');
const editorNext = byId('editor-next');
const positions = {
  folio:[31,127,114,15], fecha:[165,127,88,15], vence:[273,127,88,15],
  contrato:[396,127,133,15], telefono:[549,127,212,15], nombre:[31,166,330,15],
  correo:[396,166,365,15], importe:[396,236,365,44], letra:[396,288,365,18],
  concepto:[396,323,365,17]
};
for (const [name, [x, y, width, height]] of Object.entries(positions)) {
  const input = document.createElement('input');
  input.name = name;
  input.setAttribute('aria-label', labels[name]);
  input.style.left = (x / 792 * 100) + '%';
  input.style.top = (y / 583 * 100) + '%';
  input.style.width = (width / 792 * 100) + '%';
  input.style.height = (height / 583 * 100) + '%';
  input.maxLength = name === 'folio' ? 24 : 200;
  input.required = requiredFields.has(name);
  if (name === 'fecha' || name === 'vence') input.type = 'date';
  if (name === 'folio') input.pattern = 'RP-[0-9]{4}-[0-9]{1,16}';
  if (name === 'importe') input.inputMode = 'decimal';
  byId('draft-fields').append(input);
}
editorNext.onclick = () => newReference.click();

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

async function chooseMaster(picker) {
  try {
    const file = picker.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) throw Error('La ficha maestra supera 25 MB.');
    const bytes = await file.arrayBuffer();
    await validateMaster(bytes);
    await localMaster(bytes);
    masterBytes = bytes;
    templateState();
    byId('template-settings').open = false;
    byId('editor-template-settings').open = false;
    if (!editor.hidden) message('Plantilla guardada en este navegador. Ya puedes pulsar «Guardar copia».');
    if (draft && session) await prepareDraft();
  } catch (error) {
    message(error.message, true);
  } finally { picker.value = ''; }
}
templatePicker.addEventListener('change', () => chooseMaster(templatePicker));
const editorTemplate = byId('editor-template');
editorTemplate.addEventListener('change', () => chooseMaster(editorTemplate));

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
    issue.disabled = !current.fromPdf && !masterBytes;
    message(current.fromPdf || masterBytes ? 'Revisa los datos y pulsa «Registrar ficha».' : 'Configura la ficha maestra para preparar la copia del cliente.');
  } finally { preparingDraft = false; }
}

const saveDraft = byId('save-draft');
const editorRegister = byId('editor-register');
const draftDownload = byId('draft-download');
function clearDraftDownload() {
  if (draftDownload.hasAttribute('href')) URL.revokeObjectURL(draftDownload.href);
  draftDownload.removeAttribute('href');
  draftDownload.hidden = true;
  editorRegister.disabled = true;
}
draftForm.addEventListener('input', clearDraftDownload);
draftDownload.addEventListener('click', () => {
  editorRegister.disabled = false;
  message('Después de descargar, pulsa «Ir a registrar ficha» y selecciona ese mismo PDF.');
});

function copyName(name, folio) {
  const safe = (name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().slice(0, 120);
  return (safe ? safe + ' - ' : '') + folio + '.pdf';
}

function pdfBase64(bytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: 'application/pdf' }));
  });
}

saveDraft.addEventListener('click', async () => {
  if (!draftForm.reportValidity()) return;
  clearDraftDownload();
  saveDraft.disabled = true;
  try {
    const fields = Object.fromEntries(Object.keys(labels).map(key => {
      const value = draftForm.elements[key === 'folio_pie' ? 'folio' : key].value.trim();
      return [key, key === 'fecha' || key === 'vence' ? value.split('-').reverse().join('/') : value];
    }));
    validateFields(fields);
    if (!masterBytes) {
      try { masterBytes = await localMaster(); } catch { /* El selector permite configurarla. */ }
    }
    if (!masterBytes) {
      byId('editor-template-settings').open = true;
      editorTemplate.focus();
      message('Selecciona la ficha maestra arriba y después pulsa «Guardar copia» de nuevo.');
      return;
    }
    const { bytes, chromeMaster } = await fillMaster(masterBytes, fields);
    if (!chromeMaster) throw Error('Selecciona la ficha maestra actualizada con el QR de verificación FINEN.');
    draftDownload.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    draftDownload.download = copyName(fields.nombre, fields.folio);
    draftDownload.textContent = 'Descargar ' + draftDownload.download;
    draftDownload.hidden = false;
    draftDownload.focus();
    message('La copia está lista. Pulsa el enlace de descarga junto a «Guardar copia».');
  } catch (error) { message(error.message, true); }
  finally { saveDraft.disabled = false; }
});

let importing = false;
function openImport() {
  importing = true;
  draft = undefined;
  editor.hidden = true;
  login.hidden = Boolean(session);
  byId('import-settings').open = true;
  if (!session) login.elements.email.focus();
  message('Inicia sesión si se te solicita y selecciona la copia editable de la ficha.');
}

draftForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!editorRegister.disabled) openImport();
});
if (new URLSearchParams(location.search).get('modo') === 'editor') byId('template-settings').hidden = false;
else openImport();

newReference.addEventListener('click', () => {
  const registeredFolio = ficha?.fields.folio ?? '';
  const parts = /^(RP-\d{4}-)(\d+)$/.exec(registeredFolio);
  clearFicha();
  draft = undefined;
  if (importing) {
    pdf.value = '';
    pdf.focus();
    message('Selecciona el siguiente PDF editable.');
    return;
  }
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
    draft = { ...validateFields(fields), fromPdf: true };
    editor.hidden = true;
    login.hidden = false;
    byId('template-settings').hidden = true;
    byId('pdf').closest('details').hidden = true;
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
  editorNext.hidden = true;
  editorCopy.hidden = true;
  editorCopy.removeAttribute('href');
  saveDraft.disabled = false;
  clearDraftDownload();
  for (const input of byId('draft-fields').querySelectorAll('input')) input.readOnly = false;
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
  login.hidden = !draft && !importing;
  editor.hidden = Boolean(draft) || importing;
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
  importing = false;
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
    const prepared = current.fromDraft && !current.fromPdf
      ? { ...current, ...await fillMaster(masterBytes, current.fields) } : current;
    const bytes = prepared.bytes;
    if (!bytes) throw Error('Selecciona el PDF editable para guardar el expediente completo.');
    if (!prepared.chromeMaster) throw Error('Usa la ficha maestra actualizada para conservar el QR y el botón de verificación.');
    const encoded = await pdfBase64(bytes);
    if (auth !== session) return;
    const row = await rpc('finen_archivar_expediente', {
      p_plantilla_sha256: MASTER,
      p_pdf_sha256: await sha256(bytes),
      p_campos: current.fields,
      p_fecha_emision: current.issue,
      p_fecha_vencimiento: current.due,
      p_importe: current.amount,
      p_token_qr: current.token,
      p_archivo_base64: encoded
    });
    if (auth !== session) return;
    if (row?.folio !== current.fields.folio || !row.token_qr) {
      throw Error('El servidor devolvió una referencia que no coincide con la ficha.');
    }
    verifyLink.href = verifier(row.token_qr, row.folio);
    verifyLink.hidden = false;
    completed = true;
    newReference.hidden = Boolean(current.fromPdf);
    draft = undefined;
    message('Expediente registrado. Ya puedes enviar al cliente el mismo PDF que guardaste.');
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
  if (row.token_qr) {
    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'secondary';
    downloadButton.textContent = 'Descargar PDF';
    downloadButton.onclick = async () => {
      const auth = session;
      if (!auth) return;
      downloadButton.disabled = true;
      try {
        const encoded = await rpc('finen_descargar_expediente', { p_folio: row.folio });
        const bytes = encoded ? Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
          : await localCopy(row.folio, row.token_qr);
        if (auth !== session) return;
        if (!bytes) {
          message('La copia de este expediente no está guardada en este navegador. Busca el PDF que se descargó al registrarlo.', true);
          return;
        }
        const url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
        const link = document.createElement('a');
        link.href = url;
        link.download = copyName(row.cliente, row.folio);
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch {
        if (auth === session) message('No se pudo recuperar el PDF del expediente.', true);
      } finally {
        downloadButton.disabled = false;
      }
    };
    actions.append(downloadButton);
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
