begin;
create or replace function public.finen_editar_expediente(
  p_campos jsonb, p_fecha_emision date, p_fecha_vencimiento date,
  p_importe numeric, p_archivo_base64 text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  folio_pdf text := p_campos->>'folio';
  archivo_pdf bytea;
  referencia public.finen_referencias%rowtype;
begin
  if auth.uid() is null or public.finen_rol_actual()::text is distinct from 'ADMIN' then
    raise exception 'Acceso reservado a administración' using errcode = '42501';
  end if;
  if folio_pdf is null or folio_pdf !~ '^RP-[0-9]{4}-[0-9]{1,16}$'
    or folio_pdf is distinct from p_campos->>'folio_pie'
    or coalesce(btrim(p_campos->>'nombre'), '') = ''
    or coalesce(btrim(p_campos->>'concepto'), '') = ''
    or coalesce(btrim(p_campos->>'contrato'), '') = ''
    or coalesce(btrim(p_campos->>'letra'), '') = ''
    or p_fecha_emision is null or p_fecha_vencimiento is null
    or p_fecha_vencimiento < p_fecha_emision
    or p_importe is null or p_importe::text in ('NaN','Infinity','-Infinity')
    or p_importe <= 0 or p_importe <> round(p_importe, 2)
    or p_archivo_base64 is null or length(p_archivo_base64) > 34952536 then
    raise exception 'Revisa los datos de la ficha';
  end if;
  archivo_pdf := decode(p_archivo_base64, 'base64');
  if octet_length(archivo_pdf) > 26214400 or substring(archivo_pdf from 1 for 5) <> '\x255044462d'::bytea then
    raise exception 'Selecciona el PDF corregido';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(folio_pdf, 0));
  select r.* into referencia from public.finen_referencias r where r.folio = folio_pdf for update;
  if not found or referencia.estatus::text is distinct from 'PENDIENTE' then
    raise exception 'Solo pueden editarse referencias pendientes';
  end if;
  update finen_privado.fichas_importadas
    set campos = p_campos, pdf_sha256 = encode(sha256(archivo_pdf), 'hex')
    where folio = folio_pdf;
  if not found then raise exception 'No se encontró el expediente original'; end if;
  update public.finen_referencias
    set cliente = upper(btrim(p_campos->>'nombre')),
        folio_contrato = upper(btrim(p_campos->>'contrato')),
        concepto = upper(btrim(p_campos->>'concepto')),
        importe = p_importe, importe_letra = upper(btrim(p_campos->>'letra')),
        fecha_emision = p_fecha_emision, fecha_vencimiento = p_fecha_vencimiento
    where id = referencia.id;
  insert into finen_privado.pdf_expedientes(folio, archivo) values(folio_pdf, archivo_pdf)
    on conflict(folio) do update set archivo = excluded.archivo;
  insert into public.finen_historial(referencia_id, usuario_id, accion)
    values(referencia.id, auth.uid(), 'REFERENCIA EDITADA');
end
$$;
revoke all on function public.finen_editar_expediente(jsonb,date,date,numeric,text) from public, anon;
grant execute on function public.finen_editar_expediente(jsonb,date,date,numeric,text) to authenticated;
commit;
