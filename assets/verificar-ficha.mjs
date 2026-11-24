const endpoint = 'https://upbcsdocsoicujeylpmx.supabase.co/rest/v1/rpc/finen_verificar_ficha';
const key = 'sb_publishable_wOqfHlkJATss_6Ow_6jgaw_GepOkl6s';
const fields = {
  folio: 'Folio',
  cliente: 'Titular',
  concepto: 'Concepto',
  importe: 'Importe',
  fecha_emision: 'Emisión',
  fecha_vencimiento: 'Vencimiento',
  estatus: 'Estatus',
  deposito: 'Terminaciones de depósito'
};
const byId = id => document.getElementById(id);

function show(state, title, notice, stampText) {
  document.querySelector('main').dataset.state = state;
  byId('title').textContent = title;
  byId('issuer').hidden = state !== 'valid';
  const note = byId('notice');
  note.textContent = notice;
  note.hidden = false;
  const stamp = byId('stamp');
  stamp.hidden = !stampText;
  stamp.dataset.state = state;
  stamp.textContent = stampText ?? '';
}

function showDetails(row) {
  const details = byId('details');
  for (const [field, label] of Object.entries(fields)) {
    if (row[field] == null || row[field] === '') continue;
    const line = document.createElement('div');
    line.dataset.field = field;
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    term.textContent = label;
    value.textContent = field === 'importe' && row.moneda
      ? row.importe + ' ' + row.moneda : row[field];
    line.append(term, value);
    details.append(line);
  }
  details.hidden = false;
}

let verification = 0;

async function verify(manual) {
  const visit = ++verification;
  byId('details').replaceChildren();
  byId('details').hidden = true;
  const params = new URLSearchParams(location.hash.slice(1) || location.search);
  const token = params.get('token') ?? params.get('t') ?? '';
  const tokenPattern = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  const lookup = byId('lookup');
  lookup.hidden = Boolean(token) && !manual;
  if (!token && !manual) {
    show('waiting', 'Verificación de ficha de pago', 'Ingresa el folio y el titular que figuran en tu ficha.');
    return;
  }
  const invalid = () => show('invalid', 'Esta ficha no pertenece a FINEN', 'No realices el pago.', '×');
  if (token && !manual && !tokenPattern.test(token)) {
    invalid();
    return;
  }
  show('waiting', 'Verificando ficha de pago…', '');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(manual ?? { p_token: token, p_folio: params.get('folio') }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw Error('Fallo de verificación');
    const row = await response.json();
    if (visit !== verification) return;
    if (row === null) {
      invalid();
      return;
    }
    if (!row?.folio || !row.estatus) throw Error('Respuesta inválida');
    lookup.hidden = true;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const payable = row.estatus === 'PENDIENTE'
      && /^\d{4}-\d{2}-\d{2}$/.test(row.fecha_vencimiento)
      && row.fecha_vencimiento >= today && Boolean(row.deposito);
    show('valid', 'Ficha de pago verificada', payable
      ? 'Referencia verificada por FINEN. Realiza tu pago únicamente a una cuenta oficial que coincida con la ficha y las terminaciones registradas abajo.'
      : 'Esta referencia fue emitida por FINEN. Consulta su estado y vigencia en esta tarjeta.', '✓');
    showDetails(row);
  } catch {
    if (visit !== verification) return;
    show('unavailable', 'No pudimos verificar la ficha', 'Confirma la referencia con FINEN antes de pagar.');
  }
}
byId('lookup').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  verify({ p_folio: data.get('folio').trim(), p_cliente: data.get('cliente').trim() });
});
window.addEventListener('hashchange', () => verify());
verify();
