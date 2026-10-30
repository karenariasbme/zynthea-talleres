-- =====================================================================
-- ZYNTHEA TALLERES · Esquema v1
-- Plan Básico + Demo de 7 días (autorregistro) · Supabase / PostgreSQL
-- Ejecutar UNA vez en: SQL Editor → New query → Run
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. TALLERES (cada cliente = un taller / tenant)
-- ---------------------------------------------------------------
create table public.talleres (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  plan          text not null default 'demo'
                check (plan in ('demo','basico','estandar','profesional','premium')),
  trial_ends_at timestamptz default (now() + interval '7 days'),
  ot_seq        integer not null default 0,          -- contador de órdenes por taller
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 2. MIEMBROS (usuario → taller). 1 usuario pertenece a 1 taller
-- ---------------------------------------------------------------
create table public.miembros (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  taller_id  uuid not null references public.talleres(id) on delete cascade,
  rol        text not null default 'dueno' check (rol in ('dueno','mecanico')),
  created_at timestamptz not null default now()
);
create index miembros_taller_idx on public.miembros (taller_id);

-- ---------------------------------------------------------------
-- 3. FUNCIONES DE SEGURIDAD
--    mi_taller()     → taller del usuario (aunque la demo haya vencido)
--    taller_activo() → taller del usuario SOLO si la demo/plan está vigente
-- ---------------------------------------------------------------
create or replace function public.mi_taller()
returns uuid language sql stable security definer set search_path = '' as $$
  select taller_id from public.miembros where user_id = auth.uid()
$$;

create or replace function public.taller_activo()
returns uuid language sql stable security definer set search_path = '' as $$
  select t.id
  from public.miembros m
  join public.talleres t on t.id = m.taller_id
  where m.user_id = auth.uid()
    and (t.plan <> 'demo' or t.trial_ends_at > now())
$$;

-- ---------------------------------------------------------------
-- 4. CLIENTES
-- ---------------------------------------------------------------
create table public.clientes (
  id         uuid primary key default gen_random_uuid(),
  taller_id  uuid not null default public.mi_taller()
             references public.talleres(id) on delete cascade,
  nombre     text not null,
  cedula_ruc text,
  telefono   text,
  correo     text,
  created_at timestamptz not null default now(),
  unique (taller_id, id)
);
create index clientes_nombre_idx on public.clientes (taller_id, lower(nombre));

-- ---------------------------------------------------------------
-- 5. VEHÍCULOS (placa única por taller)
-- ---------------------------------------------------------------
create table public.vehiculos (
  id         uuid primary key default gen_random_uuid(),
  taller_id  uuid not null default public.mi_taller()
             references public.talleres(id) on delete cascade,
  cliente_id uuid not null,
  placa      text not null,
  marca      text not null,
  modelo     text not null,
  anio       smallint check (anio between 1950 and 2100),
  color      text,
  created_at timestamptz not null default now(),
  unique (taller_id, placa),
  unique (taller_id, id),
  foreign key (taller_id, cliente_id)
    references public.clientes (taller_id, id) on delete restrict
);

create or replace function public.normalizar_placa()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.placa := upper(regexp_replace(new.placa, '[[:space:]-]', '', 'g'));
  return new;
end $$;

create trigger trg_vehiculos_placa
before insert or update of placa on public.vehiculos
for each row execute function public.normalizar_placa();

-- ---------------------------------------------------------------
-- 6. ÓRDENES DE TRABAJO (código OT-0001 automático por taller)
-- ---------------------------------------------------------------
create table public.ordenes_trabajo (
  id                  uuid primary key default gen_random_uuid(),
  taller_id           uuid not null default public.mi_taller()
                      references public.talleres(id) on delete cascade,
  numero              integer not null,
  codigo              text generated always as (
                        'OT-' || case when numero < 10000
                                      then lpad(numero::text, 4, '0')
                                      else numero::text end
                      ) stored,
  vehiculo_id         uuid not null,
  tipo                text not null check (tipo in ('preventivo','correctivo')),
  motivo              text not null,
  descripcion         text,
  fecha_ingreso       timestamptz not null default now(),
  fecha_salida        timestamptz,
  observacion_ingreso text,      -- cómo llegó el vehículo
  observacion_salida  text,      -- cómo se va el vehículo
  created_by          uuid default auth.uid() references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (taller_id, numero),
  foreign key (taller_id, vehiculo_id)
    references public.vehiculos (taller_id, id) on delete restrict,
  check (fecha_salida is null or fecha_salida >= fecha_ingreso)
);
create index ot_historial_idx on public.ordenes_trabajo (taller_id, vehiculo_id, fecha_ingreso desc);

create or replace function public.asignar_numero_ot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.talleres
       set ot_seq = ot_seq + 1
     where id = new.taller_id
    returning ot_seq into new.numero;
  else
    new.numero    := old.numero;     -- el número no se puede editar
    new.taller_id := old.taller_id;  -- la orden no cambia de taller
  end if;
  return new;
end $$;

create trigger trg_ot_numero
before insert or update on public.ordenes_trabajo
for each row execute function public.asignar_numero_ot();

-- ---------------------------------------------------------------
-- 7. VISTA DE HISTORIAL (respeta RLS con security_invoker)
-- ---------------------------------------------------------------
create view public.historial_ordenes with (security_invoker = true) as
select o.id, o.codigo, o.numero, o.tipo, o.motivo, o.descripcion,
       o.fecha_ingreso, o.fecha_salida,
       o.observacion_ingreso, o.observacion_salida,
       v.id as vehiculo_id, v.placa, v.marca, v.modelo, v.anio, v.color,
       c.id as cliente_id, c.nombre as cliente_nombre,
       c.telefono as cliente_telefono, c.cedula_ruc as cliente_cedula_ruc
from public.ordenes_trabajo o
join public.vehiculos v on v.taller_id = o.taller_id and v.id = o.vehiculo_id
join public.clientes  c on c.taller_id = v.taller_id and c.id = v.cliente_id;

-- ---------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------
alter table public.talleres        enable row level security;
alter table public.miembros        enable row level security;
alter table public.clientes        enable row level security;
alter table public.vehiculos       enable row level security;
alter table public.ordenes_trabajo enable row level security;

-- El usuario ve su taller (también vencido, para mostrar el aviso)
create policy talleres_select on public.talleres
  for select to authenticated
  using (id = (select public.mi_taller()));

create policy miembros_select on public.miembros
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Datos de trabajo: solo si la demo/plan está vigente
create policy clientes_rw on public.clientes
  for all to authenticated
  using      (taller_id = (select public.taller_activo()))
  with check (taller_id = (select public.taller_activo()));

create policy vehiculos_rw on public.vehiculos
  for all to authenticated
  using      (taller_id = (select public.taller_activo()))
  with check (taller_id = (select public.taller_activo()));

create policy ordenes_rw on public.ordenes_trabajo
  for all to authenticated
  using      (taller_id = (select public.taller_activo()))
  with check (taller_id = (select public.taller_activo()));

-- ---------------------------------------------------------------
-- 9. AUTORREGISTRO: al crear usuario → crea taller demo (7 días)
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_taller uuid;
begin
  insert into public.talleres (nombre)
  values (coalesce(nullif(trim(new.raw_user_meta_data->>'taller_nombre'), ''), 'Mi taller'))
  returning id into v_taller;

  insert into public.miembros (user_id, taller_id, rol)
  values (new.id, v_taller, 'dueno');

  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- 10. PERMISOS (la exposición automática de tablas está desactivada)
-- ---------------------------------------------------------------
revoke all on public.talleres, public.miembros, public.clientes,
              public.vehiculos, public.ordenes_trabajo,
              public.historial_ordenes from anon;

grant usage on schema public to authenticated;
grant select                         on public.talleres, public.miembros to authenticated;
grant select, insert, update, delete on public.clientes, public.vehiculos  to authenticated;
grant select, insert, update         on public.ordenes_trabajo             to authenticated; -- sin delete: historial íntegro
grant select                         on public.historial_ordenes           to authenticated;

revoke execute on function public.mi_taller(), public.taller_activo(),
                           public.asignar_numero_ot(), public.normalizar_placa(),
                           public.handle_new_user()
  from public, anon;
grant execute on function public.mi_taller(), public.taller_activo() to authenticated;
