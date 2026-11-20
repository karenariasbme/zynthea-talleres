-- =====================================================================
-- ZYNTHEA TALLERES · 008 · Datos de pago del taller (Plan Estándar)  (PROPUESTA — sin ejecutar)
--
-- REGLA: solo aditivo. Sin DROP ni RENAME. No cambia datos existentes.
--   · Columna nueva talleres.datos_pago (jsonb, null = sin datos de pago) con validación.
--   · El dueño la edita desde "Mi taller" (GRANT UPDATE solo de esa columna; talleres_update del 002 limita a su taller).
--   · orden_publica y presupuesto_publico (del 007) devuelven también taller.datos_pago.
--     Copia exacta del 007, MISMA firma (create or replace conserva permisos); solo se agrega 'datos_pago'.
-- REQUIERE: 007.
-- ANTES: respaldo (Respaldo diario ✅) + Mantenimiento semanal ✅ en zynthea-ops.
-- ORDEN: ejecutar este SQL ANTES de publicar el frontend de la rama pdf-y-pago
--        (la app lee talleres.datos_pago al iniciar; sin la columna, la app no carga).
--
-- Forma de datos_pago (todas las claves opcionales; textos sin espacios al inicio/fin):
--   { "banco": "Banco Pichincha", "tipo_cuenta": "ahorros" | "corriente", "numero": "2201234567",
--     "titular": "Juan Pérez", "identificacion": "0601234567", "nota": "Envía el comprobante por WhatsApp" }
-- Ejecutar UNA vez en: SQL Editor (proyecto zynthea-talleres) → New query → Run.
-- Después: verificar_008.sql (todas las filas en ✅).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Validación: solo esas claves, textos con largo máximo, tipo de cuenta conocido, número con dígitos y guiones
-- ---------------------------------------------------------------------
create function public._datos_pago_validos(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from jsonb_each(p) e
      where e.key not in ('banco', 'tipo_cuenta', 'numero', 'titular', 'identificacion', 'nota')
         or jsonb_typeof(e.value) <> 'string'
         or length(e.value #>> '{}') = 0
         or length(e.value #>> '{}') > case e.key when 'nota' then 300 when 'numero' then 30
                                                  when 'identificacion' then 13 else 120 end)
    and coalesce(p ->> 'tipo_cuenta', 'ahorros') in ('ahorros', 'corriente')
    and coalesce(p ->> 'numero', '0') ~ '^[0-9][0-9 -]*$'
  )
$$;

-- La restricción CHECK se evalúa con los permisos de quien guarda: authenticated la necesita (igual que _horario_valido del 006).
revoke execute on function public._datos_pago_validos(jsonb) from public, anon;
grant  execute on function public._datos_pago_validos(jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Columna nueva + permiso de edición
-- ---------------------------------------------------------------------
alter table public.talleres
  add column if not exists datos_pago jsonb
      constraint talleres_datos_pago_validos check (public._datos_pago_validos(datos_pago));

grant update (datos_pago) on public.talleres to authenticated;


-- ---------------------------------------------------------------------
-- 3. Enlaces públicos: copia exacta del 007 + 'datos_pago' en el taller
-- ---------------------------------------------------------------------
-- orden_publica (del 007)
create or replace function public.orden_publica(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select jsonb_build_object(
    'taller',   jsonb_build_object('nombre', t.nombre, 'ruc', t.ruc, 'direccion', t.direccion,
                                   'telefono', t.telefono, 'correo', t.correo, 'logo_path', t.logo_path,
                                   'datos_pago', t.datos_pago),
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

-- presupuesto_publico (del 007)
create or replace function public.presupuesto_publico(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select jsonb_build_object(
    'taller',      jsonb_build_object('nombre', t.nombre, 'ruc', t.ruc, 'direccion', t.direccion,
                                      'telefono', t.telefono, 'correo', t.correo, 'logo_path', t.logo_path,
                                      'datos_pago', t.datos_pago),
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
