begin;

create schema if not exists finen_privado;
revoke all on schema finen_privado from public, anon, authenticated;

create table if not exists finen_privado.fichas_importadas (
  folio text primary key,
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  plantilla_sha256 text not null check (plantilla_sha256 ~ '^[0-9a-f]{64}$'),
  campos jsonb not null,
  registrado_por uuid not null,
  registrado_en timestamptz not null default now()
);

create or replace function public.finen_registrar_ficha_pdf(
  p_plantilla_sha256 text, p_pdf_sha256 text, p_campos jsonb,
  p_fecha_emision date, p_fecha_vencimiento date, p_importe numeric, p_token_qr text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  folio_pdf text := p_campos->>'folio';
  anterior finen_privado.fichas_importadas;
  emitida jsonb;
  devuelto jsonb;
  token_nuevo uuid;
begin
  if auth.uid() is null or public.finen_rol_actual()::text is distinct from 'ADMIN' then
    raise exception 'Acceso reservado a administración' using errcode = '42501';
  end if;
  if folio_pdf is null or folio_pdf !~ '^RP-[0-9]{4}-[0-9]{1,16}$'
    or folio_pdf is distinct from p_campos->>'folio_pie'
    or coalesce(btrim(p_campos->>'nombre'), '') = ''
    or coalesce(btrim(p_campos->>'contrato'), '') = ''
    or coalesce(btrim(p_campos->>'concepto'), '') = ''
    or coalesce(btrim(p_campos->>'letra'), '') = ''
    or p_pdf_sha256 is null or p_pdf_sha256 !~ '^[0-9a-f]{64}$'
    or p_token_qr is null or p_token_qr !~ '^[0-9a-f]{32}$'
    or p_fecha_emision is null or p_fecha_vencimiento is null
    or p_fecha_vencimiento < p_fecha_emision
    or p_importe is null or p_importe::text in ('NaN', 'Infinity', '-Infinity')
    or p_importe <= 0 or p_importe <> round(p_importe, 2) then
    raise exception 'Revisa los datos originales de la ficha' using errcode = '22023';
  end if;
  token_nuevo := p_token_qr::uuid;

  if p_plantilla_sha256 is distinct from '0cc1c6a5f328bbe4213e742cf1343f09f68abebed9281c0a337f014c4360ab98' then
    raise exception 'La ficha no coincide con la plantilla de FINEN' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(folio_pdf, 0));
  select * into anterior from finen_privado.fichas_importadas where folio = folio_pdf;
  if found then
    if anterior.pdf_sha256 <> p_pdf_sha256 or anterior.campos <> p_campos then
      raise exception 'El folio ya corresponde a otra ficha' using errcode = '23505';
    end if;
    select jsonb_build_object('folio', r.folio, 'token_qr', r.token_qr)
    into devuelto from public.finen_referencias r where r.folio = folio_pdf;
    if not found then
      raise exception 'La referencia guardada requiere revisión de administración';
    end if;
    return devuelto;
  end if;
  if exists (select 1 from public.finen_referencias r where r.folio = folio_pdf) then
    raise exception 'El folio ya existe en el registro de referencias' using errcode = '23505';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.to_jsonb(public.finen_generar_referencia(
      p_cliente => %L, p_folio_contrato => %L, p_concepto => %L, p_importe => %L,
      p_importe_letra => %L, p_fecha_vencimiento => %L, p_observaciones => %L))',
    p_campos->>'nombre', p_campos->>'contrato', p_campos->>'concepto', p_importe,
    p_campos->>'letra', p_fecha_vencimiento, ''
  ) into emitida;
  if emitida->>'folio' is null or emitida->>'token_qr' is null then
    raise exception 'El sistema de referencias no devolvió una ficha válida';
  end if;

  -- El folio, fecha y token definitivos se fijan antes de confirmar la transacción.
  execute pg_catalog.format(
    'update public.finen_referencias as r set folio = %L, fecha_emision = %L, token_qr = %L
      where r.folio = %L and r.token_qr::text = %L and r.xmin::text = pg_current_xact_id()::text
      returning pg_catalog.jsonb_build_object(''folio'', r.folio, ''token_qr'', r.token_qr)',
    folio_pdf, p_fecha_emision, token_nuevo, emitida->>'folio', emitida->>'token_qr'
  ) into devuelto;
  if devuelto is null then
    raise exception 'No se pudo identificar la referencia recién creada';
  end if;

  insert into finen_privado.fichas_importadas (folio, pdf_sha256, plantilla_sha256, campos, registrado_por)
  values (folio_pdf, p_pdf_sha256, p_plantilla_sha256, p_campos, auth.uid());
  return devuelto;
end
$$;

revoke all on function public.finen_registrar_ficha_pdf(text, text, jsonb, date, date, numeric, text) from public, anon;
grant execute on function public.finen_registrar_ficha_pdf(text, text, jsonb, date, date, numeric, text) to authenticated;

commit;
