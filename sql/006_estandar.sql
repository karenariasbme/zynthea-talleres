-- =====================================================================
-- ZYNTHEA TALLERES · 006 · Plan Estándar  (PROPUESTA — sin ejecutar)
--
-- REGLA: solo aditivo. Sin DROP ni RENAME. No borra ni cambia datos existentes
-- (salvo dar un token a cada orden existente).
-- REQUIERE: 003 (ya en la base) y 005 (usa talleres.suspendido_at).
-- ANTES: respaldo (Respaldo diario ✅) + Mantenimiento semanal ✅ en zynthea-ops.
-- Ejecutar UNA vez en: SQL Editor (proyecto zynthea-talleres) → New query → Run.
--
--   1. Ayudas: nivel de plan, token aleatorio, taller_estandar()
--   2. Órdenes: kilometraje de ingreso + token del enlace público
--   3. Presupuestos (PR-0001) con ítems, totales y "Convertir en orden"
--   4. Enlace público de orden y de presupuesto (solo lectura, por token)
--   5. Página de enlaces del taller (slug, WhatsApp, ubicación, TikTok, color)
--   6. Reservas de turno: formulario público (SECURITY DEFINER) + Agenda en la app
--   7. Permisos (incluye quitar TRUNCATE/TRIGGER/REFERENCES del 003)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. AYUDAS
-- ---------------------------------------------------------------------
-- demo y básico = 0/1; Estándar o superior = 2+. Las funciones del Estándar exigen >= 2.
create function public._plan_nivel(p_plan text)
returns integer language sql immutable set search_path = '' as $$
  select case p_plan when 'basico' then 1 when 'estandar' then 2
                     when 'profesional' then 3 when 'premium' then 4 else 0 end
$$;

-- Token de 64 caracteres hex (dos UUID v4 aleatorios ≈ 244 bits). Sin extensiones.
create function public._nuevo_token()
returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

-- Taller del usuario SOLO si está vigente, no suspendido y con plan Estándar o superior
create function public.taller_estandar()
returns uuid language sql stable security definer set search_path = '' as $$
  select t.id
  from public.miembros m
  join public.talleres t on t.id = m.taller_id
  where m.user_id = auth.uid()
    and t.suspendido_at is null
    and public._plan_nivel(t.plan) >= 2
$$;

-- El token no se elige ni se cambia desde la app: se genera al crear y se conserva al editar
create function public.proteger_token()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.token_publico := public._nuevo_token();
  else
    new.token_publico := old.token_publico;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 2. ÓRDENES: kilometraje y token del enlace público
-- ---------------------------------------------------------------------
alter table public.ordenes_trabajo
  add column if not exists kilometraje_ingreso integer
      check (kilometraje_ingreso is null or kilometraje_ingreso between 0 and 3000000),
  add column if not exists token_publico text not null default public._nuevo_token();  -- cada orden existente recibe el suyo
create unique index if not exists ordenes_token_uq on public.ordenes_trabajo (token_publico);

create trigger trg_ot_token
before insert or update on public.ordenes_trabajo
for each row execute function public.proteger_token();

-- Historial: se agrega el kilometraje al final (mismas columnas y orden del 004)
create or replace view public.historial_ordenes with (security_invoker = true) as
select o.id, o.codigo, o.numero, o.tipo, o.motivo, o.descripcion,
       o.fecha_ingreso, o.fecha_salida,
       o.observacion_ingreso, o.observacion_salida,
       v.id as vehiculo_id, v.placa, v.marca, v.modelo, v.anio, v.color,
       c.id as cliente_id, c.nombre as cliente_nombre,
       c.telefono as cliente_telefono, c.cedula_ruc as cliente_cedula_ruc,
       o.observaciones,
       o.kilometraje_ingreso
from public.ordenes_trabajo o
join public.vehiculos v on v.taller_id = o.taller_id and v.id = o.vehiculo_id
join public.clientes  c on c.taller_id = v.taller_id and c.id = v.cliente_id;

-- Ítems de la orden (003): solo con plan Estándar o superior. Política RESTRICTIVA:
-- se suma a orden_items_rw sin reemplazarla.
create policy orden_items_estandar on public.orden_items
  as restrictive for all to authenticated
  using      (taller_id = (select public.taller_estandar()))
  with check (taller_id = (select public.taller_estandar()));


-- ---------------------------------------------------------------------
-- 3. PRESUPUESTOS
-- ---------------------------------------------------------------------
alter table public.talleres
  add column if not exists pr_seq integer not null default 0;   -- contador de presupuestos (no editable)

create table public.presupuestos (
  id             uuid primary key default gen_random_uuid(),
  taller_id      uuid not null default public.mi_taller()
                 references public.talleres(id) on delete cascade,
  numero         integer not null,
  codigo         text generated always as (
                   'PR-' || case when numero < 10000 then lpad(numero::text, 4, '0') else numero::text end
                 ) stored,
  cliente_id     uuid not null,
  vehiculo_id    uuid,                                   -- opcional; obligatorio para convertir en orden
  motivo         text not null check (length(trim(motivo)) between 1 and 300),
  descripcion    text,
  observaciones  text,
  validez_dias   integer not null default 15 check (validez_dias between 1 and 365),
  aplica_iva     boolean not null default true,
  iva_porcentaje numeric not null default 15 check (iva_porcentaje >= 0 and iva_porcentaje <= 100),
  estado         text not null default 'borrador'
                 check (estado in ('borrador','enviado','aprobado','rechazado','convertido')),
  orden_id       uuid,                                   -- orden creada al convertir
  token_publico  text not null default public._nuevo_token(),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (taller_id, numero),
  unique (taller_id, id),
  unique (token_publico),
  foreign key (taller_id, cliente_id)  references public.clientes (taller_id, id)        on delete restrict,
  foreign key (taller_id, vehiculo_id) references public.vehiculos (taller_id, id)       on delete restrict,
  foreign key (taller_id, orden_id)    references public.ordenes_trabajo (taller_id, id) on delete restrict
);
create index presupuestos_taller_idx on public.presupuestos (taller_id, created_at desc);

-- Número PR automático por taller; el número, el taller y la orden convertida no se editan;
-- el vehículo debe ser del mismo cliente.
create function public.asignar_numero_presupuesto()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.talleres set pr_seq = pr_seq + 1 where id = new.taller_id
    returning pr_seq into new.numero;
  else
    new.numero    := old.numero;
    new.taller_id := old.taller_id;
    if old.orden_id is not null then
      new.orden_id := old.orden_id;
      new.estado   := 'convertido';
    end if;
  end if;
  if new.vehiculo_id is not null and not exists (
       select 1 from public.vehiculos v
       where v.taller_id = new.taller_id and v.id = new.vehiculo_id and v.cliente_id = new.cliente_id) then
    raise exception 'El vehículo no pertenece a ese cliente.' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger trg_pr_numero
before insert or update on public.presupuestos
for each row execute function public.asignar_numero_presupuesto();

create trigger trg_pr_token
before insert or update on public.presupuestos
for each row execute function public.proteger_token();

create table public.presupuesto_items (
  id              uuid primary key default gen_random_uuid(),
  taller_id       uuid not null default public.mi_taller()
                  references public.talleres(id) on delete cascade,
  presupuesto_id  uuid not null,
  tipo            text not null check (tipo in ('mano_obra','repuesto','otro')),
  descripcion     text not null check (length(trim(descripcion)) between 1 and 300),
  cantidad        numeric not null default 1 check (cantidad > 0),
  precio_unitario numeric not null default 0 check (precio_unitario >= 0),
  subtotal        numeric generated always as (round(cantidad * precio_unitario, 2)) stored,
  created_at      timestamptz not null default now(),
  foreign key (taller_id, presupuesto_id)
    references public.presupuestos (taller_id, id) on delete cascade
);
create index presupuesto_items_pr_idx on public.presupuesto_items (taller_id, presupuesto_id);

create function public.proteger_presupuesto_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.taller_id      := old.taller_id;
  new.presupuesto_id := old.presupuesto_id;
  return new;
end $$;

create trigger trg_pr_item_proteger
before update on public.presupuesto_items
for each row execute function public.proteger_presupuesto_item();

create view public.presupuestos_totales with (security_invoker = true) as
select p.id as presupuesto_id,
       coalesce(sum(i.subtotal) filter (where i.tipo = 'mano_obra'), 0) as total_mano_obra,
       coalesce(sum(i.subtotal) filter (where i.tipo = 'repuesto'), 0)  as total_repuestos,
       coalesce(sum(i.subtotal) filter (where i.tipo = 'otro'), 0)      as total_otros,
       coalesce(sum(i.subtotal), 0)                                     as subtotal,
       case when p.aplica_iva then round(coalesce(sum(i.subtotal), 0) * p.iva_porcentaje / 100, 2) else 0 end as iva,
       coalesce(sum(i.subtotal), 0)
         + case when p.aplica_iva then round(coalesce(sum(i.subtotal), 0) * p.iva_porcentaje / 100, 2) else 0 end as total
from public.presupuestos p
left join public.presupuesto_items i on i.taller_id = p.taller_id and i.presupuesto_id = p.id
group by p.id, p.aplica_iva, p.iva_porcentaje;

alter table public.presupuestos      enable row level security;
alter table public.presupuesto_items enable row level security;
create policy presupuestos_rw on public.presupuestos
  for all to authenticated
  using      (taller_id = (select public.taller_estandar()))
  with check (taller_id = (select public.taller_estandar()));
create policy presupuesto_items_rw on public.presupuesto_items
  for all to authenticated
  using      (taller_id = (select public.taller_estandar()))
  with check (taller_id = (select public.taller_estandar()));

-- Convertir en orden: corre con los permisos del usuario (RLS aplica). Copia ítems e IVA.
create function public.convertir_presupuesto(p_presupuesto uuid, p_tipo text, p_kilometraje integer default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare p public.presupuestos; v_orden uuid;
begin
  if p_tipo not in ('preventivo','correctivo') then
    raise exception 'Elige si es preventivo o correctivo.' using errcode = '22023'; end if;
  select * into p from public.presupuestos where id = p_presupuesto for update;
  if not found then raise exception 'No se encontró el presupuesto.' using errcode = 'P0002'; end if;
  if p.orden_id is not null then
    raise exception 'Este presupuesto ya se convirtió en orden.' using errcode = '22023'; end if;
  if p.vehiculo_id is null then
    raise exception 'Asigna un vehículo al presupuesto antes de convertirlo en orden.' using errcode = '22023'; end if;

  insert into public.ordenes_trabajo
    (taller_id, vehiculo_id, tipo, motivo, descripcion, observaciones, aplica_iva, iva_porcentaje, kilometraje_ingreso)
  values
    (p.taller_id, p.vehiculo_id, p_tipo, p.motivo, p.descripcion, p.observaciones, p.aplica_iva, p.iva_porcentaje, p_kilometraje)
  returning id into v_orden;

  insert into public.orden_items (taller_id, orden_id, tipo, descripcion, cantidad, precio_unitario)
  select p.taller_id, v_orden, i.tipo, i.descripcion, i.cantidad, i.precio_unitario
  from public.presupuesto_items i
  where i.taller_id = p.taller_id and i.presupuesto_id = p.id
  order by i.created_at;

  update public.presupuestos set estado = 'convertido', orden_id = v_orden where id = p.id;
  return v_orden;
end $$;


-- ---------------------------------------------------------------------
-- 4. ENLACE PÚBLICO (solo lectura, por token). Solo talleres Estándar+ no suspendidos.
--    Del taller: solo lo que ya sale en la orden impresa. Del cliente: solo el nombre.
-- ---------------------------------------------------------------------
create function public.orden_publica(p_token text)
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
    and public._plan_nivel(t.plan) >= 2;
  return r;   -- null = no existe o no disponible (la página muestra "Enlace no válido")
end $$;

create function public.presupuesto_publico(p_token text)
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
    and public._plan_nivel(t.plan) >= 2;
  return r;
end $$;


-- ---------------------------------------------------------------------
-- 5. PÁGINA DE ENLACES DEL TALLER (enlaces.html?t=<slug>) y configuración de reservas
-- ---------------------------------------------------------------------
-- Horario: {"1":["08:00","17:00"], ..., "6":["08:00","13:00"]}  (1 = lunes … 7 = domingo; sin clave = cerrado)
create function public._horario_valido(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[1-7]$' or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 2 then return false; end if;
    if (v->>0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v->>1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
    if (v->>0)::time >= (v->>1)::time then return false; end if;
  end loop;
  return true;
end $$;

alter table public.talleres
  add column if not exists slug             text unique
      check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40)),
  add column if not exists whatsapp         text check (whatsapp is null or whatsapp ~ '^[0-9]{9,15}$'),
  add column if not exists maps_url         text check (maps_url is null or (maps_url ~ '^https://' and length(maps_url) <= 300)),
  add column if not exists tiktok_url       text check (tiktok_url is null or (tiktok_url ~ '^https://(www\.)?tiktok\.com/' and length(tiktok_url) <= 300)),
  add column if not exists color_marca      text check (color_marca is null or color_marca ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists reservas_activas boolean not null default false,
  add column if not exists horario          jsonb not null
      default '{"1":["08:00","17:00"],"2":["08:00","17:00"],"3":["08:00","17:00"],"4":["08:00","17:00"],"5":["08:00","17:00"],"6":["08:00","13:00"]}'::jsonb
      check (public._horario_valido(horario)),
  add column if not exists turno_minutos    integer not null default 60 check (turno_minutos in (15, 20, 30, 45, 60, 90, 120)),
  add column if not exists turno_cupos      integer not null default 1  check (turno_cupos between 1 and 10);

-- El dueño edita estos campos desde "Mi taller" (la política talleres_update del 002 ya limita a su taller)
grant update (slug, whatsapp, maps_url, tiktok_url, color_marca,
              reservas_activas, horario, turno_minutos, turno_cupos)
  on public.talleres to authenticated;

-- Datos públicos de la página de enlaces (TikTok sale solo si tiene enlace)
create function public.taller_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'nombre', t.nombre, 'logo_path', t.logo_path, 'color_marca', t.color_marca,
           'direccion', t.direccion, 'whatsapp', t.whatsapp, 'maps_url', t.maps_url,
           'tiktok_url', t.tiktok_url, 'reservas', t.reservas_activas,
           'horario', t.horario, 'turno_minutos', t.turno_minutos)
  from public.talleres t
  where t.slug = lower(trim(p_slug))
    and t.suspendido_at is null
    and public._plan_nivel(t.plan) >= 2
$$;


-- ---------------------------------------------------------------------
-- 6. RESERVAS DE TURNO
-- ---------------------------------------------------------------------
create table public.reservas (
  id           uuid primary key default gen_random_uuid(),
  taller_id    uuid not null default public.mi_taller()
               references public.talleres(id) on delete cascade,
  fecha_hora   timestamptz not null,
  nombre       text not null check (length(trim(nombre)) between 1 and 120),
  telefono     text not null check (telefono ~ '^[0-9]{9,15}$'),
  placa        text check (placa is null or length(placa) <= 10),
  motivo       text check (motivo is null or length(motivo) <= 300),
  estado       text not null default 'pendiente'
               check (estado in ('pendiente','confirmada','atendida','cancelada','no_vino')),
  origen       text not null default 'app' check (origen in ('web','app')),
  nota_interna text check (nota_interna is null or length(nota_interna) <= 500),
  created_at   timestamptz not null default now()
);
create index reservas_agenda_idx   on public.reservas (taller_id, fecha_hora);
create index reservas_telefono_idx on public.reservas (taller_id, telefono, created_at);

alter table public.reservas enable row level security;
create policy reservas_rw on public.reservas            -- Agenda en la app (solo su taller, Estándar+)
  for all to authenticated
  using      (taller_id = (select public.taller_estandar()))
  with check (taller_id = (select public.taller_estandar()));
-- anon NO tiene permisos sobre la tabla: solo puede llamar a reservar_turno() y horarios_disponibles().

-- Horarios libres de un día (solo horas; no revela quién reservó)
create function public.horarios_disponibles(p_slug text, p_fecha date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.talleres; v_hoy date := (now() at time zone 'America/Guayaquil')::date;
        v_rango jsonb; v_h timestamp; v_fin timestamp; v_tz timestamptz; v_n integer; v_out jsonb := '[]'::jsonb;
begin
  select * into t from public.talleres
   where slug = lower(trim(p_slug)) and suspendido_at is null
     and public._plan_nivel(plan) >= 2 and reservas_activas;
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

-- Formulario público: única forma de insertar desde fuera. Valida todo en la base.
create function public.reservar_turno(p_slug text, p_fecha_hora timestamptz, p_nombre text,
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
  if not found or t.suspendido_at is not null or public._plan_nivel(t.plan) < 2 or not t.reservas_activas then
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
-- 7. PERMISOS
-- ---------------------------------------------------------------------
-- Tablas y vistas nuevas: cerradas a anon; authenticated solo lo necesario (RLS filtra por taller)
revoke all on public.presupuestos, public.presupuesto_items, public.presupuestos_totales, public.reservas
  from anon, authenticated;
grant select, insert, update, delete on public.presupuestos, public.presupuesto_items, public.reservas to authenticated;
grant select on public.presupuestos_totales to authenticated;

-- Endurecer lo del 003: sin TRUNCATE (se salta RLS), TRIGGER ni REFERENCES
revoke truncate, trigger, references on public.orden_items, public.ordenes_totales from authenticated;
revoke all on public.orden_items, public.ordenes_totales from anon;

-- Funciones: nada para nadie y luego lo justo
revoke execute on function
  public._plan_nivel(text), public._nuevo_token(), public.taller_estandar(), public.proteger_token(),
  public.asignar_numero_presupuesto(), public.proteger_presupuesto_item(), public.proteger_item(),
  public.convertir_presupuesto(uuid, text, integer),
  public.orden_publica(text), public.presupuesto_publico(text), public._horario_valido(jsonb),
  public.taller_publico(text), public.horarios_disponibles(text, date),
  public.reservar_turno(text, timestamptz, text, text, text, text)
  from public, anon, authenticated;

-- authenticated: políticas RLS, valor por defecto del token, convertir presupuesto
grant execute on function public.taller_estandar(), public._nuevo_token(), public._horario_valido(jsonb),
                          public.convertir_presupuesto(uuid, text, integer)
  to authenticated;

-- Público (anon) y también usuarios con sesión: solo lectura por token / slug y el formulario de reservas
grant execute on function public.orden_publica(text), public.presupuesto_publico(text),
                          public.taller_publico(text), public.horarios_disponibles(text, date),
                          public.reservar_turno(text, timestamptz, text, text, text, text)
  to anon, authenticated;
