-- =====================================================================
-- ZYNTHEA TALLERES · 003 · Ítems de la orden (mano de obra, repuestos) e IVA
--
-- ⚠️ YA APLICADO EN PRODUCCIÓN — NO EJECUTAR.
-- Se ejecutó desde otro chat y no quedó en GitHub. Este archivo se reconstruyó el
-- 17/11/2026 a partir de la base (pg_get_*), para que el repositorio refleje el esquema real.
-- El endurecimiento de permisos de estos objetos está en el 006.
-- =====================================================================

-- IVA por orden (Ecuador: 15 %)
alter table public.ordenes_trabajo
  add column aplica_iva     boolean not null default true,
  add column iva_porcentaje numeric not null default 15
             check (iva_porcentaje >= 0 and iva_porcentaje <= 100);

-- Ítems: cantidad × precio unitario
create table public.orden_items (
  id              uuid primary key default gen_random_uuid(),
  taller_id       uuid not null default public.mi_taller()
                  references public.talleres(id) on delete cascade,
  orden_id        uuid not null,
  tipo            text not null check (tipo in ('mano_obra','repuesto','otro')),
  descripcion     text not null,
  cantidad        numeric not null default 1 check (cantidad > 0),
  precio_unitario numeric not null default 0 check (precio_unitario >= 0),
  subtotal        numeric generated always as (round(cantidad * precio_unitario, 2)) stored,
  created_at      timestamptz not null default now(),
  foreign key (taller_id, orden_id)
    references public.ordenes_trabajo (taller_id, id) on delete cascade
);
create index orden_items_orden_idx on public.orden_items (taller_id, orden_id);

-- El ítem no cambia de taller ni de orden
create or replace function public.proteger_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.taller_id := old.taller_id;
  new.orden_id  := old.orden_id;
  return new;
end $$;

create trigger trg_item_proteger
before update on public.orden_items
for each row execute function public.proteger_item();

-- Totales por orden (respeta RLS)
create view public.ordenes_totales with (security_invoker = true) as
select o.id as orden_id,
       coalesce(sum(i.subtotal) filter (where i.tipo = 'mano_obra'), 0) as total_mano_obra,
       coalesce(sum(i.subtotal) filter (where i.tipo = 'repuesto'), 0)  as total_repuestos,
       coalesce(sum(i.subtotal) filter (where i.tipo = 'otro'), 0)      as total_otros,
       coalesce(sum(i.subtotal), 0)                                     as subtotal,
       case when o.aplica_iva then round(coalesce(sum(i.subtotal), 0) * o.iva_porcentaje / 100, 2) else 0 end as iva,
       coalesce(sum(i.subtotal), 0)
         + case when o.aplica_iva then round(coalesce(sum(i.subtotal), 0) * o.iva_porcentaje / 100, 2) else 0 end as total
from public.ordenes_trabajo o
left join public.orden_items i on i.taller_id = o.taller_id and i.orden_id = o.id
group by o.id, o.aplica_iva, o.iva_porcentaje;

-- RLS: igual que el resto de datos de trabajo
alter table public.orden_items enable row level security;
create policy orden_items_rw on public.orden_items
  for all to authenticated
  using      (taller_id = (select public.taller_activo()))
  with check (taller_id = (select public.taller_activo()));

-- Permisos tal como están en la base (incluyen TRUNCATE/TRIGGER/REFERENCES: el 006 los quita)
grant all on public.orden_items to authenticated;
grant select, references, trigger, truncate on public.ordenes_totales to authenticated;
