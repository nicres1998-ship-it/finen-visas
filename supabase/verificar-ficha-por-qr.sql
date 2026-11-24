begin;

create or replace function public.finen_verificar_qr(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  token uuid;
  ficha record;
  datos jsonb;
begin
  if p_token is null or p_token !~* '^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then
    return null;
  end if;
  token := p_token::uuid;

  select r.token_qr, r.folio, r.cliente, r.estatus
    into ficha
    from public.finen_referencias as r
    where r.token_qr::text in (token::text, replace(token::text, '-', ''));
  if not found then
    return null;
  end if;

  -- Reutiliza las reglas del verificador existente y tolera un parámetro UUID o texto.
  execute pg_catalog.format(
    'select pg_catalog.to_jsonb(public.finen_comprobar_datos(p_token => %L, p_cliente => %L, p_folio => %L))',
    ficha.token_qr, ficha.cliente, ficha.folio
  ) into datos;
  if datos is null or jsonb_typeof(datos) <> 'object' then
    return null;
  end if;

  return jsonb_build_object(
    'folio', ficha.folio,
    'cliente', ficha.cliente,
    'concepto', datos->'concepto',
    'importe', datos->'importe',
    'moneda', datos->'moneda',
    'fecha_emision', datos->'fecha_emision',
    'fecha_vencimiento', datos->'fecha_vencimiento',
    'estatus', ficha.estatus
  );
end
$$;

revoke all on function public.finen_verificar_qr(text) from public;
grant execute on function public.finen_verificar_qr(text) to anon, authenticated;

commit;
