-- =====================================================================
-- ZYNTHEA TALLERES · 005 · Panel de administración en la app  (PROPUESTA)
--
-- REGLA: solo aditivo. Sin DROP ni RENAME. No borra ni cambia datos existentes.
--   · 3 tablas nuevas: admins, invitaciones, admin_bitacora
--   · 3 columnas nuevas en talleres: plan_desde, suspendido_at, nota_suspension
--   · Reemplaza taller_activo() (misma firma): además exige "no suspendido"
--   · Trigger nuevo en auth.users para aplicar invitaciones (el de autorregistro NO se toca)
--   · Trigger nuevo en talleres: impide borrar un taller con plan pagado
-- ANTES: respaldo manual en zynthea-ops (Respaldo diario ✅) + Mantenimiento semanal ✅.
-- La administradora debe haber entrado a la app de talleres al menos una vez.
-- Ejecutar UNA vez en: SQL Editor (proyecto zynthea-talleres) → New query → Run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. COMPROBACIÓN PREVIA (no escribe nada; si falla, no se creó nada)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from auth.users where lower(email) = 'karenarias.bme@gmail.com') then
    raise exception 'karenarias.bme@gmail.com no existe en Authentication de zynthea-talleres: entra a la app una vez con ese correo y vuelve a ejecutar.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. TALLERES: columnas nuevas (no editables por la app: el GRANT UPDATE
--    por columnas del 002 no las incluye)
-- ---------------------------------------------------------------------
alter table public.talleres
  add column if not exists plan_desde      timestamptz,   -- cuándo se activó el plan pagado actual
  add column if not exists suspendido_at   timestamptz,   -- null = no suspendido
  add column if not exists nota_suspension text;          -- la ve el cliente en la pantalla de bloqueo

-- taller_activo(): igual que en el 001 + "no suspendido".
-- create or replace conserva el permiso de authenticated y las políticas que la usan.
create or replace function public.taller_activo()
returns uuid language sql stable security definer set search_path = '' as $$
  select t.id
  from public.miembros m
  join public.talleres t on t.id = m.taller_id
  where m.user_id = auth.uid()
    and t.suspendido_at is null
    and (t.plan <> 'demo' or t.trial_ends_at > now())
$$;


-- ---------------------------------------------------------------------
-- 2. ADMINS
-- ---------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

create function public._exigir_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede hacer esto.' using errcode = '42501';
  end if;
end $$;

-- Usuario por correo (sin distinguir mayúsculas)
create function public._usuario(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email))
$$;

-- ¿El taller pertenece a una administradora? (su taller de autorregistro no es cliente)
create function public._taller_de_admin(p_taller uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.miembros m join public.admins a on a.user_id = m.user_id
                 where m.taller_id = p_taller)
$$;


-- ---------------------------------------------------------------------
-- 3. BITÁCORA de acciones de administración (solo inserciones)
-- ---------------------------------------------------------------------
create table public.admin_bitacora (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid references auth.users(id) on delete set null,
  accion     text not null,
  taller_id  uuid,                         -- sin FK: el registro sobrevive aunque el taller se borre
  detalle    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_bitacora_taller_idx on public.admin_bitacora (taller_id, created_at desc);

create function public._bitacora(p_accion text, p_taller uuid, p_detalle jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_bitacora (admin_id, accion, taller_id, detalle)
  values (auth.uid(), p_accion, p_taller, coalesce(p_detalle, '{}'::jsonb))
$$;


-- ---------------------------------------------------------------------
-- 4. INVITACIONES (correo que aún no se registró)
--    No se crea el taller por adelantado: sería un taller sin usuario y el
--    mantenimiento semanal de zynthea-ops lo trataría como huérfano.
-- ---------------------------------------------------------------------
create table public.invitaciones (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  plan       text not null check (plan in ('basico','estandar','profesional','premium')),
  nombre     text not null check (length(trim(nombre)) between 1 and 120),
  estado     text not null default 'pendiente' check (estado in ('pendiente','usada','anulada')),
  creada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  usada_por  uuid references auth.users(id) on delete set null,
  taller_id  uuid,                                        -- taller que recibió el plan
  cerrada_at timestamptz
);
create unique index invitaciones_pendiente_uq on public.invitaciones (email) where estado = 'pendiente';

-- Aplica la invitación pendiente de un usuario con correo confirmado:
-- su taller demo (recién creado por handle_new_user) pasa al plan invitado. Mismo taller_id = no se pierde nada.
create function public._aplicar_invitacion(p_uid uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_email text; v_inv public.invitaciones; v_taller uuid;
begin
  select lower(u.email) into v_email from auth.users u
   where u.id = p_uid and u.email_confirmed_at is not null;
  if v_email is null then return false; end if;

  select * into v_inv from public.invitaciones
   where email = v_email and estado = 'pendiente' for update;
  if not found then return false; end if;

  select t.id into v_taller
    from public.miembros m join public.talleres t on t.id = m.taller_id
   where m.user_id = p_uid and m.rol = 'dueno' and t.plan = 'demo'
   for update of t;
  if v_taller is null then return false; end if;   -- la invitación queda pendiente y visible en el panel

  update public.talleres
     set plan = v_inv.plan, plan_desde = now(),
         nombre = case when lower(trim(nombre)) = 'mi taller' then v_inv.nombre else nombre end
   where id = v_taller;
  update public.invitaciones
     set estado = 'usada', usada_por = p_uid, taller_id = v_taller, cerrada_at = now()
   where id = v_inv.id;
  insert into public.admin_bitacora (admin_id, accion, taller_id, detalle)
  values (v_inv.creada_por, 'invitacion_usada', v_taller,
          jsonb_build_object('email', v_email, 'plan', v_inv.plan, 'invitacion_id', v_inv.id));
  return true;
end $$;

-- Trigger en auth.users. Se llama "on_auth_user_invitacion" para correr DESPUÉS de
-- "on_auth_user_created" (Postgres los ejecuta por orden alfabético): el taller demo ya existe.
-- · Google / autoconfirmación: email_confirmed_at llega en el INSERT.
-- · Correo y contraseña: llega en el UPDATE cuando confirma el correo.
-- Nunca bloquea el registro ni el inicio de sesión: si algo falla, solo deja un warning.
create function public.handle_invitacion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public._aplicar_invitacion(new.id);
  exception when others then
    raise warning 'zynthea: invitación no aplicada a %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

create trigger on_auth_user_invitacion
after insert or update of email_confirmed_at on auth.users
for each row when (new.email_confirmed_at is not null)
execute function public.handle_invitacion();


-- ---------------------------------------------------------------------
-- 5. PROTECCIÓN: un taller con plan pagado no se puede borrar
--    (ni por la limpieza de huérfanos de zynthea-ops ni por error).
--    Para un borrado intencional: alter table public.talleres disable trigger trg_talleres_proteger_plan;
-- ---------------------------------------------------------------------
create function public.proteger_taller_con_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.plan <> 'demo' then
    raise exception 'El taller "%" tiene plan % y no se puede borrar.', old.nombre, old.plan
      using errcode = '42501';
  end if;
  return old;
end $$;

create trigger trg_talleres_proteger_plan
before delete on public.talleres
for each row execute function public.proteger_taller_con_plan();


-- ---------------------------------------------------------------------
-- 6. FUNCIONES DEL PANEL (todas empiezan con _exigir_admin(); se identifican por taller_id)
-- ---------------------------------------------------------------------

-- 6.1 Demos y clientes: una fila por taller (sin los talleres de administradoras)
create function public.admin_talleres()
returns table (taller_id uuid, nombre text, plan text, estado text, dueno_email text, telefono text,
               trial_ends_at timestamptz, plan_desde timestamptz, suspendido_at timestamptz,
               nota_suspension text, ordenes integer, ultima_orden timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return query
    select t.id, t.nombre, t.plan,
           case when t.suspendido_at is not null then 'suspendido'
                when t.plan <> 'demo'            then 'activo'
                when t.trial_ends_at > now()     then 'demo'
                else 'demo_vencida' end,
           (select u.email::text from public.miembros m join auth.users u on u.id = m.user_id
             where m.taller_id = t.id and m.rol = 'dueno' order by m.created_at limit 1),
           t.telefono, t.trial_ends_at, t.plan_desde, t.suspendido_at, t.nota_suspension,
           (select count(*)::integer from public.ordenes_trabajo o where o.taller_id = t.id),
           (select max(o.fecha_ingreso) from public.ordenes_trabajo o where o.taller_id = t.id),
           t.created_at
    from public.talleres t
    where not public._taller_de_admin(t.id)
    order by t.created_at desc;
end $$;

-- 6.2 Activar plan: demo (vigente o vencida) → plan pagado. Mismo taller: clientes, vehículos
--     y órdenes de la demo quedan intactos. trial_ends_at se conserva como historial.
create function public.admin_activar_plan(p_taller uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_antes text;
begin
  perform public._exigir_admin();
  if p_plan not in ('basico','estandar','profesional','premium') then
    raise exception 'Plan no válido.' using errcode = '22023'; end if;
  if public._taller_de_admin(p_taller) then
    raise exception 'Ese es un taller de administradora, no de cliente.' using errcode = '22023'; end if;
  select plan into v_antes from public.talleres where id = p_taller for update;
  if not found then raise exception 'No existe ese taller.' using errcode = 'P0002'; end if;
  if v_antes <> 'demo' then
    raise exception 'Ese taller ya tiene el plan %. Usa "Cambiar plan".', v_antes using errcode = '22023'; end if;

  update public.talleres set plan = p_plan, plan_desde = now() where id = p_taller;
  perform public._bitacora('activar_plan', p_taller, jsonb_build_object('antes', v_antes, 'plan', p_plan));
  return jsonb_build_object('taller_id', p_taller, 'plan_antes', v_antes, 'plan', p_plan);
end $$;

-- 6.3 Cambiar plan: entre planes pagados (no vuelve a demo)
create function public.admin_cambiar_plan(p_taller uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_antes text;
begin
  perform public._exigir_admin();
  if p_plan not in ('basico','estandar','profesional','premium') then
    raise exception 'Plan no válido.' using errcode = '22023'; end if;
  select plan into v_antes from public.talleres where id = p_taller for update;
  if not found then raise exception 'No existe ese taller.' using errcode = 'P0002'; end if;
  if v_antes = 'demo' then
    raise exception 'Ese taller está en demo. Usa "Activar plan".' using errcode = '22023'; end if;
  if v_antes = p_plan then
    raise exception 'Ese taller ya está en ese plan.' using errcode = '22023'; end if;

  update public.talleres set plan = p_plan, plan_desde = now() where id = p_taller;
  perform public._bitacora('cambiar_plan', p_taller, jsonb_build_object('antes', v_antes, 'plan', p_plan));
  return jsonb_build_object('taller_id', p_taller, 'plan_antes', v_antes, 'plan', p_plan);
end $$;

-- 6.4 Suspender / reactivar (no borra nada; RLS bloquea los datos mientras esté suspendido)
create function public.admin_suspender(p_taller uuid, p_nota text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  if public._taller_de_admin(p_taller) then
    raise exception 'Ese es un taller de administradora.' using errcode = '22023'; end if;
  update public.talleres
     set suspendido_at = now(), nota_suspension = nullif(trim(coalesce(p_nota, '')), '')
   where id = p_taller and suspendido_at is null;
  if not found then raise exception 'Ese taller no existe o ya está suspendido.' using errcode = 'P0002'; end if;
  perform public._bitacora('suspender', p_taller, jsonb_build_object('nota', p_nota));
  return jsonb_build_object('taller_id', p_taller, 'estado', 'suspendido');
end $$;

create function public.admin_reactivar(p_taller uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_plan text; v_fin timestamptz;
begin
  perform public._exigir_admin();
  update public.talleres set suspendido_at = null, nota_suspension = null
   where id = p_taller and suspendido_at is not null
  returning plan, trial_ends_at into v_plan, v_fin;
  if not found then raise exception 'Ese taller no existe o no está suspendido.' using errcode = 'P0002'; end if;
  perform public._bitacora('reactivar', p_taller, '{}'::jsonb);
  return jsonb_build_object('taller_id', p_taller, 'estado', 'reactivado',
                            'demo_vencida', v_plan = 'demo' and v_fin <= now());  -- aviso para el panel
end $$;

-- 6.5 Dar acceso por correo: si ya se registró (y confirmó el correo), activa su taller demo;
--     si no existe, deja una invitación que se aplica sola al registrarse.
create function public.admin_dar_acceso(p_email text, p_plan text, p_nombre text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_uid uuid; v_conf timestamptz;
        v_taller uuid; v_plan text; v_inv uuid;
begin
  perform public._exigir_admin();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo válido.' using errcode = '22023'; end if;
  if p_plan not in ('basico','estandar','profesional','premium') then raise exception 'Plan no válido.' using errcode = '22023'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Escribe el nombre del taller.' using errcode = '22023'; end if;

  v_uid := public._usuario(v_email);
  if v_uid is not null then
    if exists (select 1 from public.admins where user_id = v_uid) then
      raise exception 'Ese correo es de administradora, no de cliente.' using errcode = '22023'; end if;
    select email_confirmed_at into v_conf from auth.users where id = v_uid;
    if v_conf is null then
      raise exception 'Ese correo se registró pero aún no confirma su cuenta. Pídele que confirme y vuelve a intentar.' using errcode = '22023'; end if;
    select t.id, t.plan into v_taller, v_plan
      from public.miembros m join public.talleres t on t.id = m.taller_id where m.user_id = v_uid;
    if v_taller is null then raise exception 'Ese usuario no tiene taller.' using errcode = 'P0002'; end if;
    if v_plan <> 'demo' then
      raise exception 'Ese taller ya tiene el plan %. Usa "Cambiar plan".', v_plan using errcode = '22023'; end if;
    return public.admin_activar_plan(v_taller, p_plan) || jsonb_build_object('resultado', 'activado');
  end if;

  if exists (select 1 from public.invitaciones where email = v_email and estado = 'pendiente') then
    raise exception 'Ya hay una invitación pendiente para ese correo. Anúlala primero si quieres cambiarla.' using errcode = '22023'; end if;
  insert into public.invitaciones (email, plan, nombre, creada_por)
  values (v_email, p_plan, trim(p_nombre), auth.uid()) returning id into v_inv;
  perform public._bitacora('invitar', null, jsonb_build_object('email', v_email, 'plan', p_plan, 'invitacion_id', v_inv));
  return jsonb_build_object('resultado', 'invitado', 'invitacion_id', v_inv, 'email', v_email,
                            'plan', p_plan, 'nombre', trim(p_nombre));
end $$;

-- 6.6 Invitaciones pendientes
create function public.admin_invitaciones()
returns table (id uuid, email text, plan text, nombre text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return query
    select i.id, i.email, i.plan, i.nombre, i.created_at from public.invitaciones i
    where i.estado = 'pendiente' order by i.created_at;
end $$;

create function public.admin_anular_invitacion(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  update public.invitaciones set estado = 'anulada', cerrada_at = now() where id = p_id and estado = 'pendiente';
  if not found then raise exception 'La invitación ya se usó o ya estaba anulada.' using errcode = 'P0002'; end if;
  perform public._bitacora('anular_invitacion', null, jsonb_build_object('invitacion_id', p_id));
  return jsonb_build_object('invitacion_id', p_id, 'estado', 'anulada');
end $$;


-- ---------------------------------------------------------------------
-- 7. SEGURIDAD: tablas nuevas cerradas a la app; solo se ejecutan las admin_*
-- ---------------------------------------------------------------------
alter table public.admins         enable row level security;   -- sin políticas: la app no las lee
alter table public.invitaciones   enable row level security;
alter table public.admin_bitacora enable row level security;
revoke all on public.admins, public.invitaciones, public.admin_bitacora from anon, authenticated;

revoke execute on function
  public.es_admin(), public._exigir_admin(), public._usuario(text), public._taller_de_admin(uuid),
  public._bitacora(text, uuid, jsonb), public._aplicar_invitacion(uuid), public.handle_invitacion(),
  public.proteger_taller_con_plan(),
  public.admin_talleres(), public.admin_activar_plan(uuid, text), public.admin_cambiar_plan(uuid, text),
  public.admin_suspender(uuid, text), public.admin_reactivar(uuid),
  public.admin_dar_acceso(text, text, text), public.admin_invitaciones(), public.admin_anular_invitacion(uuid)
  from public, anon, authenticated;

-- authenticated: cada admin_* comprueba es_admin() por dentro. Las _* y los triggers quedan internos.
grant execute on function
  public.es_admin(),
  public.admin_talleres(), public.admin_activar_plan(uuid, text), public.admin_cambiar_plan(uuid, text),
  public.admin_suspender(uuid, text), public.admin_reactivar(uuid),
  public.admin_dar_acceso(text, text, text), public.admin_invitaciones(), public.admin_anular_invitacion(uuid)
  to authenticated;
-- taller_activo() conserva su permiso (create or replace no lo cambia).


-- ---------------------------------------------------------------------
-- 8. LA ADMINISTRADORA
--    Su taller de autorregistro se queda (la app lo necesita para no expulsarla),
--    pero se excluye del panel y de los reportes de zynthea-ops.
-- ---------------------------------------------------------------------
do $$
declare v_uid uuid := public._usuario('karenarias.bme@gmail.com');
begin
  if exists (select 1 from public.miembros m join public.talleres t on t.id = m.taller_id
             where m.user_id = v_uid and t.plan <> 'demo') then
    raise exception 'Ese correo es dueño de un taller con plan pagado: usa otro correo para administrar.';
  end if;
  insert into public.admins (user_id) values (v_uid) on conflict (user_id) do nothing;
end $$;
