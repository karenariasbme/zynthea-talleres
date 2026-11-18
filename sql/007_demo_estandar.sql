-- =====================================================================
-- ZYNTHEA TALLERES · 007 · La demo vigente tiene las funciones del Plan Estándar  (PROPUESTA — sin ejecutar)
--
-- REGLA: solo aditivo. Sin DROP ni RENAME. No cambia tablas ni datos.
--   · Función nueva _con_estandar(plan, trial_ends_at)
--   · Reemplaza 6 funciones del 006 con la MISMA firma (create or replace conserva permisos y políticas).
--     Su código es copia exacta del 006; solo cambia la condición de plan:
--        _plan_nivel(plan) >= 2   →   _con_estandar(plan, trial_ends_at)
-- REQUIERE: 006.
-- ANTES: respaldo (Respaldo diario ✅) + Mantenimiento semanal ✅ en zynthea-ops.
-- ORDEN: ejecutar este SQL ANTES de publicar el frontend de la rama demo-estandar
--        (si no, la demo vería el Estándar en pantalla pero la base lo bloquearía).
--
-- Reglas:
--   · Plan Estándar o superior            → Estándar (como hoy).
--   · Demo vigente (trial_ends_at > now()) → Estándar.
--   · Demo vencida                         → nada (taller_activo() ya la bloquea; las páginas públicas tampoco responden).
--   · Plan Básico                          → sin Estándar (candado). Sus datos no se borran: solo no los ve mientras sea Básico.
--   · Suspendido                           → nada (cada función ya exige suspendido_at is null; no cambia).
-- Ejecutar UNA vez en: SQL Editor (proyecto zynthea-talleres) → New query → Run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ¿El taller tiene las funciones del Estándar?
-- ---------------------------------------------------------------------
-- Corregido al ejecutarlo (18/11/2026): una demo sin fecha de fin devolvía null; coalesce(…, false) la deja en false.
create function public._con_estandar(p_plan text, p_trial_ends_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select public._plan_nivel(p_plan) >= 2
      or coalesce(p_plan = 'demo' and p_trial_ends_at > now(), false)
$$;

revoke execute on function public._con_estandar(text, timestamptz) from public, anon, authenticated;
-- Solo la usan funciones SECURITY DEFINER (corren como su dueño): no necesita permiso para la app.


-- ---------------------------------------------------------------------
-- 2. Las 6 funciones del 006 con la nueva condición (copia exacta, misma firma)
-- ---------------------------------------------------------------------
-- taller_estandar (del 006)
create or replace function public.taller_estandar()
returns uuid language sql stable security definer set search_path = '' as $$
  select t.id
  from public.miembros m
  join public.talleres t on t.id = m.taller_id
  where m.user_id = auth.uid()
    and t.suspendido_at is null
    and public._con_estandar(t.plan, t.trial_ends_at)
$$;

-- orden_publica (del 006)
create or replace function public.orden_publica(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select jsonb_build_object(
    'taller',   jsonb_build_object('nombre', t.nombre, 'ruc', t.ruc, 'direccion', t.direccion,
                                   'telefono', t.telefono, 'correo', t.correo, 'logo_path', t.logo_path),
    'orden',    jsonb_build_object('codigo', o.codigo, 'tipo', o.tipo, 'motivo', o.motivo,
                                   'descripcion', o.descripcion, 'fecha_ingreso', o.fecha_ingreso,
                                   'fecha_salida', o.fecha_salida, 'kilometraje_ingreso', o.kilometraje_ingreso,
                                   'observacion_ingreso', o.observacion_ingreso,
                                   'observacion_salida', o.observacion_salida, 'observaciones', o.observaciones,
                                   'aplica_iva', o.aplica_iva, 'iva_porcentaje', o.iva_porcentaje),
    'vehiculo', jsonb_build_object('placa', v.placa, 'marca', v.marca, 'modelo', v.modelo,
                                   'anio', v.anio, 'color', v.color),
    'cliente',  jsonb_build_object('nombre', c.nombre),
    'items',    coalesce((select jsonb_agg(jsonb_build_object('tipo', i.tipo, 'descripcion', i.descripcion,
                                   'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario,
                                   'subtotal', i.subtotal) order by i.created_at)
                          from public.orden_items i
                          where i.taller_id = o.taller_id and i.orden_id = o.id), '[]'::jsonb),
    'totales',  (select to_jsonb(x) - 'orden_id' from public.ordenes_totales x where x.orden_id = o.id))
  into r
  from public.ordenes_trabajo o
  join public.talleres  t on t.id = o.taller_id
  join public.vehiculos v on v.taller_id = o.taller_id and v.id = o.vehiculo_id
  join public.clientes  c on c.taller_id = v.taller_id and c.id = v.cliente_id
  where o.token_publico = p_token
    and t.suspendido_at is null
    and public._con_estandar(t.plan, t.trial_ends_at);
  return r;   -- null = no existe o no disponible (la página muestra "Enlace no válido")
end $$;

-- presupuesto_publico (del 006)
create or replace function public.presupuesto_publico(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select jsonb_build_object(
    'taller',      jsonb_build_object('nombre', t.nombre, 'ruc', t.ruc, 'direccion', t.direccion,
                                      'telefono', t.telefono, 'correo', t.correo, 'logo_path', t.logo_path),
    'presupuesto', jsonb_build_object('codigo', p.codigo, 'motivo', p.motivo, 'descripcion', p.descripcion,
                                      'observaciones', p.observaciones, 'fecha', p.created_at,
                                      'valido_hasta', p.created_at + make_interval(days => p.validez_dias),
                                      'aplica_iva', p.aplica_iva, 'iva_porcentaje', p.iva_porcentaje),
    'vehiculo',    case when v.id is null then null else
                   jsonb_build_object('placa', v.placa, 'marca', v.marca, 'modelo', v.modelo,
                                      'anio', v.anio, 'color', v.color) end,
    'cliente',     jsonb_build_object('nombre', c.nombre),
    'items',       coalesce((select jsonb_agg(jsonb_build_object('tipo', i.tipo, 'descripcion', i.descripcion,
                                      'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario,
                                      'subtotal', i.subtotal) order by i.created_at)
                             from public.presupuesto_items i
                             where i.taller_id = p.taller_id and i.presupuesto_id = p.id), '[]'::jsonb),
    'totales',     (select to_jsonb(x) - 'presupuesto_id' from public.presupuestos_totales x where x.presupuesto_id = p.id))
  into r
  from public.presupuestos p
  join public.talleres t on t.id = p.taller_id
  join public.clientes c on c.taller_id = p.taller_id and c.id = p.cliente_id
  left join public.vehiculos v on v.taller_id = p.taller_id and v.id = p.vehiculo_id
  where p.token_publico = p_token
    and t.suspendido_at is null
    and public._con_estandar(t.plan, t.trial_ends_at);
  return r;
end $$;

-- taller_publico (del 006)
create or replace function public.taller_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'nombre', t.nombre, 'logo_path', t.logo_path, 'color_marca', t.color_marca,
           'direccion', t.direccion, 'whatsapp', t.whatsapp, 'maps_url', t.maps_url,
           'tiktok_url', t.tiktok_url, 'reservas', t.reservas_activas,
           'horario', t.horario, 'turno_minutos', t.turno_minutos)
  from public.talleres t
  where t.slug = lower(trim(p_slug))
    and t.suspendido_at is null
    and public._con_estandar(t.plan, t.trial_ends_at)
$$;

-- horarios_disponibles (del 006)
create or replace function public.horarios_disponibles(p_slug text, p_fecha date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.talleres; v_hoy date := (now() at time zone 'America/Guayaquil')::date;
        v_rango jsonb; v_h timestamp; v_fin timestamp; v_tz timestamptz; v_n integer; v_out jsonb := '[]'::jsonb;
begin
  select * into t from public.talleres
   where slug = lower(trim(p_slug)) and suspendido_at is null
     and public._con_estandar(plan, trial_ends_at) and reservas_activas;
  if not found or p_fecha is null or p_fecha < v_hoy or p_fecha > v_hoy + 60 then return v_out; end if;
  v_rango := t.horario -> extract(isodow from p_fecha)::int::text;
  if v_rango is null then return v_out; end if;
  v_h   := p_fecha + (v_rango->>0)::time;
  v_fin := p_fecha + (v_rango->>1)::time;
  while v_h + make_interval(mins => t.turno_minutos) <= v_fin loop
    v_tz := v_h at time zone 'America/Guayaquil';
    if v_tz >= now() + interval '1 hour' then
      select count(*) into v_n from public.reservas
       where taller_id = t.id and fecha_hora = v_tz and estado in ('pendiente','confirmada');
      if v_n < t.turno_cupos then v_out := v_out || to_jsonb(v_tz); end if;
    end if;
    v_h := v_h + make_interval(mins => t.turno_minutos);
  end loop;
  return v_out;
end $$;

-- reservar_turno (del 006)
create or replace function public.reservar_turno(p_slug text, p_fecha_hora timestamptz, p_nombre text,
                                      p_telefono text, p_placa text default null, p_motivo text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare t public.talleres; v_local timestamp; v_rango jsonb; v_ini time; v_fin time;
        v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
        v_nombre text := trim(coalesce(p_nombre, ''));
        v_placa text := nullif(upper(regexp_replace(coalesce(p_placa, ''), '[[:space:]-]', '', 'g')), '');
        v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
        v_n integer;
begin
  -- Bloquea la fila del taller: dos reservas simultáneas no pueden pasarse del cupo
  select * into t from public.talleres where slug = lower(trim(coalesce(p_slug, ''))) for update;
  if not found or t.suspendido_at is not null or not public._con_estandar(t.plan, t.trial_ends_at) or not t.reservas_activas then
    raise exception 'Este taller no recibe reservas en línea.' using errcode = 'P0002'; end if;

  if length(v_nombre) not between 2 and 120 then raise exception 'Escribe tu nombre.' using errcode = '22023'; end if;
  if v_tel !~ '^[0-9]{9,15}$' then raise exception 'Escribe un teléfono válido.' using errcode = '22023'; end if;
  if v_placa is not null and length(v_placa) > 10 then raise exception 'La placa no es válida.' using errcode = '22023'; end if;
  if v_motivo is not null and length(v_motivo) > 300 then raise exception 'El motivo es muy largo (máx. 300).' using errcode = '22023'; end if;

  if p_fecha_hora is null or p_fecha_hora < now() + interval '1 hour' then
    raise exception 'Elige una fecha y hora futura (al menos 1 hora de anticipación).' using errcode = '22023'; end if;
  if p_fecha_hora > now() + interval '60 days' then
    raise exception 'Solo se puede reservar hasta 60 días adelante.' using errcode = '22023'; end if;

  v_local := p_fecha_hora at time zone 'America/Guayaquil';
  v_rango := t.horario -> extract(isodow from v_local)::int::text;
  if v_rango is null then raise exception 'El taller no atiende ese día.' using errcode = '22023'; end if;
  v_ini := (v_rango->>0)::time; v_fin := (v_rango->>1)::time;
  -- (se compara como timestamp para que un turno no "dé la vuelta" a la medianoche)
  if v_local::time < v_ini or v_local + make_interval(mins => t.turno_minutos) > v_local::date + v_fin then
    raise exception 'Fuera del horario de atención (% a %).', to_char(v_ini, 'HH24:MI'), to_char(v_fin, 'HH24:MI')
      using errcode = '22023'; end if;
  if extract(second from v_local) <> 0
     or (extract(epoch from (v_local::time - v_ini))::integer / 60) % t.turno_minutos <> 0 then
    raise exception 'Elige uno de los horarios disponibles.' using errcode = '22023'; end if;

  select count(*) into v_n from public.reservas
   where taller_id = t.id and fecha_hora = p_fecha_hora and estado in ('pendiente','confirmada');
  if v_n >= t.turno_cupos then raise exception 'Ese horario ya está lleno. Elige otro.' using errcode = '22023'; end if;

  -- Límite por teléfono: 1 reserva activa por día de cita y 3 solicitudes web en 24 h
  select count(*) into v_n from public.reservas
   where taller_id = t.id and telefono = v_tel and estado in ('pendiente','confirmada')
     and (fecha_hora at time zone 'America/Guayaquil')::date = v_local::date;
  if v_n >= 1 then raise exception 'Ya tienes una reserva para ese día. Si necesitas cambiarla, escríbenos por WhatsApp.' using errcode = '22023'; end if;
  select count(*) into v_n from public.reservas
   where taller_id = t.id and telefono = v_tel and origen = 'web' and created_at > now() - interval '24 hours';
  if v_n >= 3 then raise exception 'Demasiadas reservas seguidas. Escríbenos por WhatsApp.' using errcode = '22023'; end if;
  -- Límite general anti-spam: 40 reservas web por taller en 24 h
  select count(*) into v_n from public.reservas
   where taller_id = t.id and origen = 'web' and created_at > now() - interval '24 hours';
  if v_n >= 40 then raise exception 'No se pudo registrar la reserva. Escríbenos por WhatsApp.' using errcode = '22023'; end if;

  insert into public.reservas (taller_id, fecha_hora, nombre, telefono, placa, motivo, origen)
  values (t.id, p_fecha_hora, v_nombre, v_tel, v_placa, v_motivo, 'web');

  -- Solo confirma lo que la persona envió; nunca devuelve datos de otras reservas
  return jsonb_build_object('taller', t.nombre, 'fecha_hora', p_fecha_hora, 'whatsapp', t.whatsapp);
end $$;


-- ---------------------------------------------------------------------
-- 3. Permisos: create or replace los conserva. Se repiten por claridad (mismo resultado que el 006).
-- ---------------------------------------------------------------------
grant execute on function public.taller_estandar() to authenticated;
grant execute on function public.orden_publica(text), public.presupuesto_publico(text),
                          public.taller_publico(text), public.horarios_disponibles(text, date),
                          public.reservar_turno(text, timestamptz, text, text, text, text)
  to anon, authenticated;
