-- =====================================================================
-- ZYNTHEA TALLERES · 007 · Guardar orden / presupuesto con sus ítems en UNA transacción  (PROPUESTA)
--
-- REGLA: solo aditivo. Sin DROP ni RENAME. Solo crea funciones nuevas; no cambia tablas ni datos.
-- REQUIERE: 006.
-- ANTES: respaldo (Respaldo diario ✅) + Mantenimiento semanal ✅ en zynthea-ops.
--
-- Por qué: desde el navegador, crear cliente → vehículo → orden → ítems son varias llamadas; si una falla,
-- puede quedar la orden a medias. Estas funciones hacen todo dentro de la base: o se guarda todo, o nada.
--
-- SECURITY INVOKER: corren con los permisos del usuario, así que RLS sigue aplicando igual que hoy
-- (cada taller solo escribe lo suyo; los ítems siguen exigiendo Plan Estándar por la política restrictiva del 006).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ítems: validación común y orden de las filas
--    p_items = [{"tipo":"mano_obra"|"repuesto"|"otro","descripcion":"…","cantidad":1,"precio_unitario":10,"costo_unitario":null}, …]
--    created_at = now() + n ms conserva el orden en que se escribieron las filas.
-- ---------------------------------------------------------------------
create function public._validar_items(p_items jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare x record;
begin
  if p_items is null then return; end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Los ítems no tienen el formato correcto.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Máximo 200 filas de mano de obra y repuestos.' using errcode = '22023'; end if;
  for x in select * from jsonb_to_recordset(p_items)
             as r(tipo text, descripcion text, cantidad numeric, precio_unitario numeric, costo_unitario numeric) loop
    if x.tipo is null or x.tipo not in ('mano_obra','repuesto','otro') then
      raise exception 'Tipo de ítem no válido.' using errcode = '22023'; end if;
    if length(trim(coalesce(x.descripcion, ''))) not between 1 and 300 then
      raise exception 'Cada fila necesita una descripción (máx. 300 caracteres).' using errcode = '22023'; end if;
    if x.cantidad is null or x.cantidad <= 0 then
      raise exception 'La cantidad de "%" debe ser mayor que 0.', trim(x.descripcion) using errcode = '22023'; end if;
    if x.precio_unitario is null or x.precio_unitario < 0 then
      raise exception 'El precio de "%" debe ser 0 o más.', trim(x.descripcion) using errcode = '22023'; end if;
    if x.costo_unitario is not null and x.costo_unitario < 0 then
      raise exception 'El costo de "%" debe ser 0 o más.', trim(x.descripcion) using errcode = '22023'; end if;
  end loop;
end $$;

create function public._insertar_items_orden(p_taller uuid, p_orden uuid, p_items jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then return; end if;
  insert into public.orden_items (taller_id, orden_id, tipo, descripcion, cantidad, precio_unitario, costo_unitario, created_at)
  select p_taller, p_orden, e.j->>'tipo', trim(e.j->>'descripcion'),
         (e.j->>'cantidad')::numeric, (e.j->>'precio_unitario')::numeric,
         case when e.j->>'tipo' = 'repuesto' then nullif(e.j->>'costo_unitario', '')::numeric end,
         now() + make_interval(secs => (e.n / 1000.0)::double precision)
  from jsonb_array_elements(p_items) with ordinality as e(j, n);
end $$;

create function public._insertar_items_presupuesto(p_taller uuid, p_presupuesto uuid, p_items jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then return; end if;
  insert into public.presupuesto_items (taller_id, presupuesto_id, tipo, descripcion, cantidad, precio_unitario, costo_unitario, created_at)
  select p_taller, p_presupuesto, e.j->>'tipo', trim(e.j->>'descripcion'),
         (e.j->>'cantidad')::numeric, (e.j->>'precio_unitario')::numeric,
         case when e.j->>'tipo' = 'repuesto' then nullif(e.j->>'costo_unitario', '')::numeric end,
         now() + make_interval(secs => (e.n / 1000.0)::double precision)
  from jsonb_array_elements(p_items) with ordinality as e(j, n);
end $$;

-- Cliente existente ({"id":…}) o nuevo ({"nombre":…, "cedula_ruc":…, "telefono":…, "correo":…})
create function public._cliente_de(p_cliente jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v uuid;
begin
  if p_cliente ? 'id' then
    select id into v from public.clientes where id = (p_cliente->>'id')::uuid;   -- RLS: solo clientes del taller
    if v is null then raise exception 'No encontramos ese cliente.' using errcode = 'P0002'; end if;
    return v;
  end if;
  if length(trim(coalesce(p_cliente->>'nombre', ''))) = 0 then
    raise exception 'Escribe el nombre del cliente o elige uno registrado.' using errcode = '22023'; end if;
  insert into public.clientes (nombre, cedula_ruc, telefono, correo)
  values (trim(p_cliente->>'nombre'), nullif(trim(p_cliente->>'cedula_ruc'), ''),
          nullif(trim(p_cliente->>'telefono'), ''), nullif(trim(p_cliente->>'correo'), ''))
  returning id into v;
  return v;
end $$;


-- ---------------------------------------------------------------------
-- 2. ORDEN: crear y editar con ítems
-- ---------------------------------------------------------------------
-- p_vehiculo: {"id":…} existente o {"placa","marca","modelo","anio","color"} nuevo (del cliente indicado)
-- p_orden: {"tipo","motivo","descripcion","fecha_ingreso","observacion_ingreso","observaciones",
--           "kilometraje_ingreso","aplica_iva","iva_porcentaje"}
create function public.crear_orden_completa(p_cliente jsonb, p_vehiculo jsonb, p_orden jsonb, p_items jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_taller uuid := public.taller_activo(); v_cli uuid; v_veh uuid; v_id uuid; v_cod text;
begin
  if v_taller is null then raise exception 'Tu taller no está activo.' using errcode = '42501'; end if;
  perform public._validar_items(p_items);

  if p_vehiculo ? 'id' then
    select id, cliente_id into v_veh, v_cli from public.vehiculos where id = (p_vehiculo->>'id')::uuid;
    if v_veh is null then raise exception 'No encontramos ese vehículo.' using errcode = 'P0002'; end if;
  else
    v_cli := public._cliente_de(p_cliente);
    insert into public.vehiculos (cliente_id, placa, marca, modelo, anio, color)
    values (v_cli, p_vehiculo->>'placa', nullif(trim(p_vehiculo->>'marca'), ''), nullif(trim(p_vehiculo->>'modelo'), ''),
            nullif(p_vehiculo->>'anio', '')::smallint, nullif(trim(p_vehiculo->>'color'), ''))
    returning id into v_veh;
  end if;

  insert into public.ordenes_trabajo
    (vehiculo_id, tipo, motivo, descripcion, fecha_ingreso, observacion_ingreso, observaciones,
     kilometraje_ingreso, aplica_iva, iva_porcentaje)
  values
    (v_veh, p_orden->>'tipo', nullif(trim(p_orden->>'motivo'), ''), nullif(trim(p_orden->>'descripcion'), ''),
     coalesce((p_orden->>'fecha_ingreso')::timestamptz, now()),
     nullif(trim(p_orden->>'observacion_ingreso'), ''), nullif(trim(p_orden->>'observaciones'), ''),
     nullif(p_orden->>'kilometraje_ingreso', '')::integer,
     coalesce((p_orden->>'aplica_iva')::boolean, true), coalesce((p_orden->>'iva_porcentaje')::numeric, 15))
  returning id, codigo into v_id, v_cod;

  perform public._insertar_items_orden(v_taller, v_id, p_items);
  return jsonb_build_object('id', v_id, 'codigo', v_cod);
end $$;

-- p_items = null → no toca los ítems (Plan Básico); [] → los quita todos.
create function public.editar_orden_completa(p_id uuid, p_orden jsonb, p_items jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_taller uuid := public.taller_activo(); v_cod text;
begin
  if v_taller is null then raise exception 'Tu taller no está activo.' using errcode = '42501'; end if;
  perform public._validar_items(p_items);

  update public.ordenes_trabajo o set
    tipo                = p_orden->>'tipo',
    motivo              = nullif(trim(p_orden->>'motivo'), ''),
    descripcion         = nullif(trim(p_orden->>'descripcion'), ''),
    fecha_ingreso       = coalesce((p_orden->>'fecha_ingreso')::timestamptz, o.fecha_ingreso),
    observacion_ingreso = nullif(trim(p_orden->>'observacion_ingreso'), ''),
    observaciones       = nullif(trim(p_orden->>'observaciones'), ''),
    kilometraje_ingreso = case when p_orden ? 'kilometraje_ingreso'
                               then nullif(p_orden->>'kilometraje_ingreso', '')::integer else o.kilometraje_ingreso end,
    aplica_iva          = coalesce((p_orden->>'aplica_iva')::boolean, o.aplica_iva),
    iva_porcentaje      = coalesce((p_orden->>'iva_porcentaje')::numeric, o.iva_porcentaje),
    fecha_salida        = case when p_orden ? 'fecha_salida' then (p_orden->>'fecha_salida')::timestamptz else o.fecha_salida end,
    observacion_salida  = case when p_orden ? 'observacion_salida'
                               then nullif(trim(p_orden->>'observacion_salida'), '') else o.observacion_salida end
  where o.id = p_id
  returning o.codigo into v_cod;
  if v_cod is null then raise exception 'No encontramos esta orden.' using errcode = 'P0002'; end if;

  if p_items is not null then
    delete from public.orden_items where orden_id = p_id;
    perform public._insertar_items_orden(v_taller, p_id, p_items);
  end if;
  return jsonb_build_object('id', p_id, 'codigo', v_cod);
end $$;


-- ---------------------------------------------------------------------
-- 3. PRESUPUESTO: crear y editar con ítems
-- ---------------------------------------------------------------------
-- p_presupuesto: {"vehiculo_id","motivo","descripcion","observaciones","validez_dias","aplica_iva","iva_porcentaje"}
create function public.crear_presupuesto_completo(p_cliente jsonb, p_presupuesto jsonb, p_items jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_taller uuid := public.taller_activo(); v_cli uuid; v_id uuid; v_cod text;
begin
  if v_taller is null then raise exception 'Tu taller no está activo.' using errcode = '42501'; end if;
  perform public._validar_items(p_items);
  v_cli := public._cliente_de(p_cliente);

  insert into public.presupuestos
    (cliente_id, vehiculo_id, motivo, descripcion, observaciones, validez_dias, aplica_iva, iva_porcentaje)
  values
    (v_cli, nullif(p_presupuesto->>'vehiculo_id', '')::uuid, nullif(trim(p_presupuesto->>'motivo'), ''),
     nullif(trim(p_presupuesto->>'descripcion'), ''), nullif(trim(p_presupuesto->>'observaciones'), ''),
     coalesce((p_presupuesto->>'validez_dias')::integer, 15),
     coalesce((p_presupuesto->>'aplica_iva')::boolean, true), coalesce((p_presupuesto->>'iva_porcentaje')::numeric, 15))
  returning id, codigo into v_id, v_cod;

  perform public._insertar_items_presupuesto(v_taller, v_id, p_items);
  return jsonb_build_object('id', v_id, 'codigo', v_cod);
end $$;

create function public.editar_presupuesto_completo(p_id uuid, p_presupuesto jsonb, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_taller uuid := public.taller_activo(); v_cod text; v_orden uuid;
begin
  if v_taller is null then raise exception 'Tu taller no está activo.' using errcode = '42501'; end if;
  perform public._validar_items(p_items);
  select orden_id into v_orden from public.presupuestos where id = p_id for update;
  if not found then raise exception 'No encontramos este presupuesto.' using errcode = 'P0002'; end if;
  if v_orden is not null then
    raise exception 'Este presupuesto ya se convirtió en orden y no se puede editar.' using errcode = '22023'; end if;

  update public.presupuestos p set
    vehiculo_id    = nullif(p_presupuesto->>'vehiculo_id', '')::uuid,
    motivo         = nullif(trim(p_presupuesto->>'motivo'), ''),
    descripcion    = nullif(trim(p_presupuesto->>'descripcion'), ''),
    observaciones  = nullif(trim(p_presupuesto->>'observaciones'), ''),
    validez_dias   = coalesce((p_presupuesto->>'validez_dias')::integer, p.validez_dias),
    aplica_iva     = coalesce((p_presupuesto->>'aplica_iva')::boolean, p.aplica_iva),
    iva_porcentaje = coalesce((p_presupuesto->>'iva_porcentaje')::numeric, p.iva_porcentaje)
  where p.id = p_id
  returning p.codigo into v_cod;

  if p_items is not null then
    delete from public.presupuesto_items where presupuesto_id = p_id;
    perform public._insertar_items_presupuesto(v_taller, p_id, p_items);
  end if;
  return jsonb_build_object('id', p_id, 'codigo', v_cod);
end $$;


-- ---------------------------------------------------------------------
-- 4. PERMISOS: solo usuarios con sesión (anon no puede ejecutar nada de esto)
--    Son SECURITY INVOKER: el permiso real lo siguen dando RLS y las políticas de cada tabla.
-- ---------------------------------------------------------------------
revoke execute on function
  public._validar_items(jsonb),
  public._insertar_items_orden(uuid, uuid, jsonb), public._insertar_items_presupuesto(uuid, uuid, jsonb),
  public._cliente_de(jsonb),
  public.crear_orden_completa(jsonb, jsonb, jsonb, jsonb), public.editar_orden_completa(uuid, jsonb, jsonb),
  public.crear_presupuesto_completo(jsonb, jsonb, jsonb), public.editar_presupuesto_completo(uuid, jsonb, jsonb)
  from public, anon, authenticated;

-- Las auxiliares también, porque una función INVOKER llama a otras con el usuario que la invoca
grant execute on function
  public._validar_items(jsonb),
  public._insertar_items_orden(uuid, uuid, jsonb), public._insertar_items_presupuesto(uuid, uuid, jsonb),
  public._cliente_de(jsonb),
  public.crear_orden_completa(jsonb, jsonb, jsonb, jsonb), public.editar_orden_completa(uuid, jsonb, jsonb),
  public.crear_presupuesto_completo(jsonb, jsonb, jsonb), public.editar_presupuesto_completo(uuid, jsonb, jsonb)
  to authenticated;
