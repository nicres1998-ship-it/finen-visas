begin;

create table if not exists finen_privado.pdf_expedientes (
  folio text primary key references finen_privado.fichas_importadas(folio),
  archivo bytea not null
);
revoke all on finen_privado.pdf_expedientes from public, anon, authenticated;

create or replace function public.finen_archivar_expediente(
  p_plantilla_sha256 text, p_pdf_sha256 text, p_campos jsonb,
  p_fecha_emision date, p_fecha_vencimiento date, p_importe numeric,
  p_token_qr text, p_archivo_base64 text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  archivo_pdf bytea;
  referencia jsonb;
begin
  if auth.uid() is null or public.finen_rol_actual()::text is distinct from 'ADMIN' then
    raise exception 'Acceso reservado a administración' using errcode = '42501';
  end if;
  if p_archivo_base64 is null or length(p_archivo_base64) > 34952536 then
    raise exception 'El archivo supera 25 MB o está vacío' using errcode = '22023';
  end if;
  archivo_pdf := decode(p_archivo_base64, 'base64');
  if octet_length(archivo_pdf) > 26214400 or substring(archivo_pdf from 1 for 5) <> '\x255044462d'::bytea
      or encode(sha256(archivo_pdf), 'hex') is distinct from p_pdf_sha256 then
    raise exception 'El PDF no coincide con el expediente' using errcode = '22023';
  end if;
  referencia := public.finen_registrar_ficha_pdf(
    p_plantilla_sha256, p_pdf_sha256, p_campos, p_fecha_emision,
    p_fecha_vencimiento, p_importe, p_token_qr
  );
  insert into finen_privado.pdf_expedientes(folio, archivo)
  values (referencia->>'folio', archivo_pdf) on conflict (folio) do nothing;
  return referencia;
end
$$;

create or replace function public.finen_descargar_expediente(p_folio text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or public.finen_rol_actual()::text is distinct from 'ADMIN' then
    raise exception 'Acceso reservado a administración' using errcode = '42501';
  end if;
  return (select encode(archivo, 'base64') from finen_privado.pdf_expedientes where folio = p_folio);
end
$$;

revoke all on function public.finen_archivar_expediente(text,text,jsonb,date,date,numeric,text,text) from public, anon;
grant execute on function public.finen_archivar_expediente(text,text,jsonb,date,date,numeric,text,text) to authenticated;
revoke all on function public.finen_descargar_expediente(text) from public, anon;
grant execute on function public.finen_descargar_expediente(text) to authenticated;

commit;
