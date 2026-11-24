const labels = {
  folio: 'Folio de referencia', fecha: 'Emisión', vence: 'Vencimiento',
  contrato: 'Folio de contrato', nombre: 'Titular', telefono: 'Teléfono',
  correo: 'Correo', concepto: 'Concepto', importe: 'Importe',
  letra: 'Importe en letra', folio_pie: 'Folio al pie'
};
export { labels };

export const verifier = token => new URL(
  '/verificar.html#token=' + encodeURIComponent(token), 'https://finenvisas.com.mx'
).href;

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function templateFingerprint(page) {
  const { PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef } = PDFLib;
  const context = page.node.context;
  const cache = new Map();
  async function describe(object, ancestors = []) {
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (ancestors.includes(key)) throw Error('La estructura de la ficha no coincide con la plantilla.');
      if (!cache.has(key)) cache.set(key, await describe(context.lookup(object), [...ancestors, key]));
      return cache.get(key);
    }
    if (object instanceof PDFRawStream) {
      return [await describe(object.dict, ancestors), await sha256(object.getContents())];
    }
    if (object instanceof PDFDict) {
      const entries = object.entries().sort(([a], [b]) => a.toString().localeCompare(b.toString(), 'en'));
      return Promise.all(entries.filter(([key]) => key.toString() !== '/Length')
        .map(async ([key, value]) => [key.toString(), await describe(value, ancestors)]));
    }
    if (object instanceof PDFArray) {
      return Promise.all(object.asArray().map(value => describe(value, ancestors)));
    }
    return object?.toString() ?? null;
  }
  const keys = ['MediaBox', 'CropBox', 'Rotate', 'UserUnit', 'Contents', 'Resources'];
  const values = [];
  for (const key of keys) {
    const name = PDFName.of(key);
    values.push(await describe(page.node.getInheritableAttribute(name)));
  }
  return sha256(new TextEncoder().encode(JSON.stringify(values)));
}

export const MASTER = '0cc1c6a5f328bbe4213e742cf1343f09f68abebed9281c0a337f014c4360ab98';
const QR_IMAGE = 'fzImg8';

function normalizeDate(raw) {
  const value = raw.trim();
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const formatted = parts ? [parts[3], parts[2], parts[1]].join('-') : value;
  const date = new Date(formatted + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(formatted) || !Number.isFinite(+date)
      || date.toISOString().slice(0, 10) !== formatted) throw Error('Revisa las fechas de la ficha.');
  return formatted;
}

export async function readFicha(bytes) {
  const document = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const [page, ...rest] = document.getPages();
  if (!page || rest.length || await templateFingerprint(page) !== MASTER) {
    throw Error('El diseño de este PDF no coincide con la ficha maestra.');
  }
  const form = document.getForm();
  const fields = Object.fromEntries(Object.keys(labels).map(key => [key, form.getTextField(key).getText() ?? '']));
  if (!['folio', 'contrato', 'nombre', 'concepto', 'importe', 'letra'].every(key => fields[key].trim())) {
    throw Error('Completa el folio, contrato, titular, concepto e importe en el PDF.');
  }
  if (fields.folio !== fields.folio_pie || !/^RP-\d{4}-\d+$/.test(fields.folio)) {
    throw Error('El folio principal debe coincidir con el folio al pie.');
  }
  const issue = normalizeDate(fields.fecha);
  const due = normalizeDate(fields.vence);
  if (due < issue) throw Error('El vencimiento es anterior a la emisión.');
  const amount = fields.importe.trim().replace(/^\$\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(amount)
      || !Number.isFinite(Number(amount.replaceAll(',', ''))) || Number(amount.replaceAll(',', '')) <= 0) {
    throw Error('Revisa el importe de la ficha.');
  }
  return { document, page, fields, issue, due, amount: amount.replaceAll(',', ''), hash: await sha256(bytes) };
}

export async function replaceQr({ document, page }, qr, token) {
  const { PDFDict, PDFName } = PDFLib;
  const code = qr(0, 'M');
  code.addData(verifier(token));
  code.make();
  const count = code.getModuleCount();
  const dimension = count + 8;
  const commands = [`1 g 0 0 ${dimension} ${dimension} re f`, '0 g'];
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (code.isDark(row, column)) commands.push(`${column + 4} ${count - row + 3} 1 1 re`);
    }
  }
  commands.push('f');
  const context = document.context;
  const stream = context.flateStream(commands.join('\n'), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, dimension, dimension],
    Matrix: [1 / dimension, 0, 0, 1 / dimension, 0, 0], Resources: {}
  });
  const images = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  if (!images.has(PDFName.of(QR_IMAGE))) throw Error('Falta el QR original de la ficha.');
  images.set(PDFName.of(QR_IMAGE), context.register(stream));
  return document.save({ updateFieldAppearances: false });
}
