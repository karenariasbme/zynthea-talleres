-- =====================================================================
-- ZYNTHEA TALLERES · 004 · Campo de observaciones generales en la orden
-- Ejecutar UNA vez en: SQL Editor → New query → Run
-- =====================================================================
alter table public.ordenes_trabajo
  add column if not exists observaciones text;

-- Vista de historial: se agrega la columna al final (mismo orden de las demás)
create or replace view public.historial_ordenes with (security_invoker = true) as
select o.id, o.codigo, o.numero, o.tipo, o.motivo, o.descripcion,
       o.fecha_ingreso, o.fecha_salida,
       o.observacion_ingreso, o.observacion_salida,
       v.id as vehiculo_id, v.placa, v.marca, v.modelo, v.anio, v.color,
       c.id as cliente_id, c.nombre as cliente_nombre,
       c.telefono as cliente_telefono, c.cedula_ruc as cliente_cedula_ruc,
       o.observaciones
from public.ordenes_trabajo o
join public.vehiculos v on v.taller_id = o.taller_id and v.id = o.vehiculo_id
join public.clientes  c on c.taller_id = v.taller_id and c.id = v.cliente_id;
