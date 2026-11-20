-- SOLO LECTURA · zynthea-talleres · ¿está completo el 008 (datos de pago)?
-- Esperado: todas las filas en ✅. No cambia datos (las pruebas de validación usan valores fijos, no la tabla).
with casos(caso, valor, esperado) as (values
  ('sin datos (null)',            null::jsonb,                                                        true),
  ('completo',                    '{"banco":"Banco Pichincha","tipo_cuenta":"ahorros","numero":"2201234567","titular":"Juan Pérez","identificacion":"0601234567","nota":"Envía el comprobante por WhatsApp"}'::jsonb, true),
  ('solo número',                 '{"numero":"2201-234567"}'::jsonb,                                  true),
  ('cuenta corriente',            '{"tipo_cuenta":"corriente"}'::jsonb,                               true),
  ('clave desconocida',           '{"clave":"x"}'::jsonb,                                             false),
  ('tipo de cuenta inválido',     '{"tipo_cuenta":"plazo fijo"}'::jsonb,                              false),
  ('número con letras',           '{"numero":"ABC123"}'::jsonb,                                       false),
  ('texto vacío',                 '{"banco":""}'::jsonb,                                              false),
  ('valor no texto',              '{"numero":2201234567}'::jsonb,                                     false),
  ('nota de más de 300',          jsonb_build_object('nota', repeat('x', 301)),                       false),
  ('no es objeto',                '["Banco"]'::jsonb,                                                 false))

select 'columna' as chequeo, 'talleres.datos_pago' as nombre,
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'talleres' and column_name = 'datos_pago' and data_type = 'jsonb')
            then '✅' else '❌ FALTA' end as estado

union all
select 'restricción', 'talleres_datos_pago_validos',
       case when exists (select 1 from pg_constraint where conname = 'talleres_datos_pago_validos'
                         and conrelid = 'public.talleres'::regclass) then '✅' else '❌ FALTA' end

union all
select 'la app puede editarla', 'update (datos_pago)',
       case when has_column_privilege('authenticated', 'public.talleres', 'datos_pago', 'update') then '✅' else '❌' end

union all
select 'función de validación', '_datos_pago_validos',
       case when p.oid is null then '❌ FALTA'
            when has_function_privilege('anon', p.oid, 'execute') then '❌ anon puede ejecutarla'
            when not has_function_privilege('authenticated', p.oid, 'execute') then '❌ la app no podría guardar'
            else '✅' end
from (select 1) x
left join pg_proc p on p.proname = '_datos_pago_validos' and p.pronamespace = 'public'::regnamespace

union all
select 'devuelve datos_pago', f.nombre,
       case when p.oid is null then '❌ FALTA'
            when pg_get_functiondef(p.oid) like '%''datos_pago'', t.datos_pago%'
             and pg_get_functiondef(p.oid) like '%_con_estandar(t.plan, t.trial_ends_at)%' then '✅'
            else '❌ sigue la versión del 007' end
from (values ('orden_publica'), ('presupuesto_publico')) f(nombre)
left join pg_proc p on p.proname = f.nombre and p.pronamespace = 'public'::regnamespace

union all
select 'validación', c.caso,
       case when public._datos_pago_validos(c.valor) = c.esperado then '✅'
            else '❌ devuelve ' || public._datos_pago_validos(c.valor)::text end
from casos c

-- Informativo: cuántos talleres ya llenaron sus datos de pago
union all
select 'talleres con datos de pago', count(*)::text, '✅'
from public.talleres where datos_pago is not null

-- Permisos de anon: siguen siendo exactamente las 5 funciones públicas
union all
select 'anon ejecuta', coalesce(string_agg(p.proname, ', ' order by p.proname), '(nada)'),
       case when coalesce(array_agg(p.proname::text order by p.proname), '{}') =
                 array['horarios_disponibles','orden_publica','presupuesto_publico','reservar_turno','taller_publico']
            then '✅' else '❌ revisar la lista' end
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
  and has_function_privilege('anon', p.oid, 'execute');
