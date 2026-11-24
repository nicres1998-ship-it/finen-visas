import * as PDFLib from './vendor/pdf-lib-1.17.1.mjs';
import qrcode from './vendor/qrcode-generator-2.0.4.mjs';

const labels = {
  folio: 'Folio de referencia', fecha: 'Emisión', vence: 'Vencimiento',
  contrato: 'Folio de contrato', nombre: 'Titular', telefono: 'Teléfono',
  correo: 'Correo', concepto: 'Concepto', importe: 'Importe',
  letra: 'Importe en letra', folio_pie: 'Folio al pie'
};
export { labels };

export const verifier = (token, folio) => new URL(
  '/verificar.html#' + new URLSearchParams({ token, folio }), 'https://finenvisas.com.mx'
).href;

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function templateFingerprint(page, normalizeCompression = false) {
  const { PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } = PDFLib;
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
      if (normalizeCompression && object.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode'
          && !object.dict.has(PDFName.of('DecodeParms'))) {
        const metadata = object.dict.clone();
        metadata.delete(PDFName.of('Filter'));
        return [await describe(metadata, ancestors), await sha256(decodePDFRawStream(object).decode())];
      }
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
const MASTER_DECODED = '666542c8c01dca2d818de977b5698a56c46330df6086e7df001726004cdcd31a';
const MASTER_CHROME = 'e9e6cbfadf8e9886c5ae80d0a8be9d9ff56f6865c502888220a11804b1a10b09';
const MASTER_DIRECT = '95589a6aa89915ee33ce5dc63e5f12fdac099906bc528a4b1e4def86d3fafee1';
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
  const form = document.getForm();
  if (form.getFields().length === 0) {
    throw Error('Este PDF quedó como copia de impresión. Abre la ficha maestra, llénala y usa Archivo → Guardar como en tu lector de PDF. Evita «Guardar copia» y «Imprimir», porque quitan los campos editables.');
  }
  const { PDFDict, PDFName, PDFString, PDFHexString } = PDFLib;
  const issued = page?.node.Annots()?.asArray().some(ref => {
    const annotation = document.context.lookup(ref);
    if (!(annotation instanceof PDFDict)) return false;
    const action = annotation.lookup(PDFName.of('A'));
    if (!(action instanceof PDFDict)) return false;
    const uri = action.lookup(PDFName.of('URI'));
    return (uri instanceof PDFString || uri instanceof PDFHexString)
      && uri.decodeText().startsWith('https://finenvisas.com.mx/verificar.html#token=');
  });
  if (issued) {
    throw Error('Este PDF ya tiene el botón «Verificar ficha». Puedes enviarlo al cliente o consultar su folio en Referencias.');
  }
  const chromeMaster = await inspectMaster(document);
  const fields = Object.fromEntries(Object.keys(labels).map(key => [key, form.getTextField(key).getText() ?? '']));
  return { ...validateFields(fields), chromeMaster, bytes, hash: await sha256(bytes) };
}

export async function inspectMaster(document) {
  const [page, ...rest] = document.getPages();
  const normalized = page && !rest.length ? await templateFingerprint(page, true) : '';
  const chromeMaster = normalized === MASTER_CHROME || normalized === MASTER_DIRECT;
  if (!page || rest.length || (!chromeMaster && normalized !== MASTER_DECODED
      && await templateFingerprint(page) !== MASTER)) {
    throw Error('No pude reconocer esta versión de la ficha editable. Adjunta ese mismo PDF en el chat para revisar cómo lo guardó tu lector.');
  }
  if (!Object.keys(labels).every(key => document.getForm().getFieldMaybe(key) instanceof PDFLib.PDFTextField)) {
    throw Error('Selecciona una ficha maestra editable de FINEN.');
  }
  return chromeMaster;
}

export async function fillMaster(bytes, fields) {
  const document = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const chromeMaster = await inspectMaster(document);
  const form = document.getForm();
  for (const key of Object.keys(labels)) form.getTextField(key).setText(fields[key]);
  return { bytes: await document.save(), chromeMaster };
}

export async function validateMaster(bytes) {
  await inspectMaster(await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }));
}

export function validateFields(fields) {
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
  return { fields, issue, due, amount: amount.replaceAll(',', '') };
}

export async function prepareDeliveryPdf({ bytes, fields, chromeMaster }, token) {
  const { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, rgb } = PDFLib;
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = document.getPage(0);
  const url = verifier(token, fields.folio);
  const context = document.context;
  const code = qrcode(0, 'M');
  code.addData(url);
  code.make();
  const modules = code.getModuleCount();
  const sizeWithMargin = modules + 8;
  const scale = (chromeMaster ? .74 : .9) / sizeWithMargin;
  const commands = [`1 g 0 0 ${sizeWithMargin} ${sizeWithMargin} re f`, '0 g'];
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (code.isDark(y, x)) commands.push(`${x + 4} ${modules + 3 - y} 1 1 re`);
    }
  }
  commands.push('f');
  const qr = context.flateStream(commands.join('\n'), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, sizeWithMargin, sizeWithMargin],
    Matrix: [scale, 0, 0, scale, chromeMaster ? .13 : .05, chromeMaster ? .225 : .075], Resources: {}
  });
  const images = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  if (!images.has(PDFName.of(QR_IMAGE))) throw Error('Falta el espacio de verificación de la ficha.');
  images.set(PDFName.of(QR_IMAGE), context.register(qr));

  if (chromeMaster) {
    const form = document.getForm();
    const registerButton = form.getFieldMaybe('registrar_finen');
    if (registerButton) {
      for (const widget of registerButton.acroField.getWidgets()) {
        const ref = context.getObjectRef(widget.dict);
        if (ref) page.node.removeAnnot(ref);
      }
      form.removeField(registerButton);
    }
    const annotations = page.node.Annots();
    let verificationLink;
    for (let i = annotations.size() - 1; i >= 0; i--) {
      const annotation = annotations.lookup(i);
      if (!(annotation instanceof PDFDict)) continue;
      const action = annotation.lookup(PDFName.of('A'));
      if (!(action instanceof PDFDict)) continue;
      const uri = action.lookup(PDFName.of('URI'));
      if (!(uri instanceof PDFString)) continue;
      if (uri.decodeText() === 'https://finenvisas.com.mx/verificar.html?v=maestro1') {
        action.set(PDFName.of('URI'), PDFString.of(url));
        verificationLink = true;
      }
      if (uri.decodeText() === 'https://finenvisas.com.mx/admin.html?v=chrome1') annotations.remove(i);
    }
    if (!verificationLink) throw Error('No se encontró el botón «Verificar ficha».');
    page.drawRectangle({ x: 346, y: 7, width: 134, height: 20, color: rgb(.9294, .9725, .9725) });
    return document.save({ updateFieldAppearances: false });
  }
  const button = { x: 269, y: 85.25, width: 96, height: 10.75 };
  const label = 'Verificar ficha';
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const size = 7.5;
  page.drawRectangle({ ...button, color: rgb(.07, .29, .37) });
  page.drawText(label, {
    x: button.x + (button.width - font.widthOfTextAtSize(label, size)) / 2,
    y: button.y + 2.45, size, font, color: rgb(1, 1, 1)
  });
  const link = context.obj({
    Type: 'Annot', Subtype: 'Link', P: page.ref, Border: [0, 0, 0],
    Rect: [button.x, button.y, button.x + button.width, button.y + button.height],
    Contents: PDFString.of(label),
    A: { S: 'URI', URI: PDFString.of(url) }
  });
  page.node.addAnnot(context.register(link));
  return document.save({ updateFieldAppearances: false });
}
