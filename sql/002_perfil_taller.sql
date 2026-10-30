-- =====================================================================
-- ZYNTHEA TALLERES · 002 · Perfil del taller (nombre, datos y logo)
-- Ejecutar UNA vez en: SQL Editor → New query → Run
-- =====================================================================

-- 1. Datos de la empresa en el taller
alter table public.talleres
  add column if not exists ruc       text,
  add column if not exists direccion text,
  add column if not exists telefono  text,
  add column if not exists correo    text,
  add column if not exists logo_path text;   -- ruta del logo en Storage

-- 2. Solo el dueño puede editar su taller
create policy talleres_update on public.talleres
  for update to authenticated
  using (
    id = (select public.mi_taller())
    and exists (select 1 from public.miembros m
                where m.user_id = (select auth.uid()) and m.rol = 'dueno')
  )
  with check (id = (select public.mi_taller()));

-- Solo estas columnas son editables (plan, trial_ends_at y ot_seq quedan protegidas)
grant update (nombre, ruc, direccion, telefono, correo, logo_path)
  on public.talleres to authenticated;

-- 3. Bucket de logos (público para mostrarlos e imprimirlos; máx. 1 MB; sin SVG)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- 4. Cada taller solo escribe en su carpeta: logos/<taller_id>/archivo
create policy logos_select_propio on storage.objects
  for select to authenticated
  using (bucket_id = 'logos'
         and (storage.foldername(name))[1] = (select public.mi_taller())::text);

create policy logos_insert_propio on storage.objects
  for insert to authenticated
  with check (bucket_id = 'logos'
              and (storage.foldername(name))[1] = (select public.mi_taller())::text);

create policy logos_update_propio on storage.objects
  for update to authenticated
  using      (bucket_id = 'logos'
              and (storage.foldername(name))[1] = (select public.mi_taller())::text)
  with check (bucket_id = 'logos'
              and (storage.foldername(name))[1] = (select public.mi_taller())::text);

create policy logos_delete_propio on storage.objects
  for delete to authenticated
  using (bucket_id = 'logos'
         and (storage.foldername(name))[1] = (select public.mi_taller())::text);
