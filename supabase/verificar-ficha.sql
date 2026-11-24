begin;

create or replace function public.finen_verificar_ficha(p_token text default null, p_folio text default null, p_cliente text default null)
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
  deposito text;
begin
  if p_token is not null then
    if p_token !~* '^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then
      return null;
    end if;
    token := p_token::uuid;
    select r.token_qr, r.folio, r.cliente, r.estatus into ficha
    from public.finen_referencias r
    where r.token_qr::text in (token::text, replace(token::text, '-', ''))
      and (p_folio is null or r.folio = p_folio);
  else
    if p_folio is null or p_folio !~ '^RP-[0-9]{4}-[0-9]{1,16}$'
       or coalesce(length(btrim(p_cliente)), 0) not between 1 and 200 then
      return null;
    end if;
    select r.token_qr, r.folio, r.cliente, r.estatus into ficha
    from public.finen_referencias r
    where r.folio = p_folio and lower(btrim(r.cliente)) = lower(btrim(p_cliente));
  end if;
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

  with recursive cuentas(valor) as (
    select datos->'cuentas'
    union all
    select hijo.valor from cuentas c cross join lateral (
      select value as valor from jsonb_array_elements(
        case jsonb_typeof(c.valor) when 'array' then c.valor else '[]'::jsonb end)
      union all
      select value from jsonb_each(
        case jsonb_typeof(c.valor) when 'object' then c.valor else '{}'::jsonb end)
      where jsonb_typeof(value) in ('object', 'array')
    ) hijo
  ), terminaciones as (
    select distinct case
      when clave ~* 'clabe' then 'CLABE'
      when clave ~* 'tarjeta' then 'Tarjeta'
      else 'Cuenta'
    end as tipo,
    right(regexp_replace(campo #>> '{}', '[^0-9]', '', 'g'), 4) as ultimos
    from cuentas cross join lateral jsonb_each(
      case jsonb_typeof(valor) when 'object' then valor else '{}'::jsonb end
    ) as d(clave, campo)
    where clave ~* '^(clabe|cuenta|tarjeta|numero[_ ](cuenta|tarjeta)|numero[_ ]de[_ ](cuenta|tarjeta))$'
      and (campo #>> '{}') ~ '^[0-9][0-9 -]{2,30}[0-9]$'
      and length(regexp_replace(campo #>> '{}', '[^0-9]', '', 'g')) >= 4
  )
  select string_agg(tipo || ' •••• ' || ultimos, ' · ' order by tipo, ultimos)
    into deposito from terminaciones;

  return jsonb_build_object(
    'folio', ficha.folio,
    'cliente', ficha.cliente,
    'concepto', datos->'concepto',
    'importe', datos->'importe',
    'moneda', datos->'moneda',
    'fecha_emision', datos->'fecha_emision',
    'fecha_vencimiento', datos->'fecha_vencimiento',
    'estatus', ficha.estatus,
    'deposito', deposito
  );
end
$$;

revoke all on function public.finen_verificar_ficha(text, text, text) from public;
grant execute on function public.finen_verificar_ficha(text, text, text) to anon, authenticated;

commit;
