# Sistema para Talleres · Zynthea Solutions

App web para talleres mecánicos: clientes, vehículos, órdenes de trabajo con código automático (OT-0001) e historial por placa. Esta versión cubre el **Plan Básico** e incluye una **demo gratuita de 7 días** con autorregistro.

- **App:** https://karenariasbme.github.io/zynthea-talleres/
- **Planes:** https://karenariasbme.github.io/KarenArias/talleres/

## Cómo funciona

- **Frontend:** HTML, CSS y JavaScript vanilla (ES modules), sin build. Se publica tal cual con GitHub Pages desde la rama `main`.
- **Backend:** Supabase (PostgreSQL + Auth + Row Level Security + Storage). Esquema en [`sql/001_esquema.sql`](sql/001_esquema.sql); datos y logo del taller en [`sql/002_perfil_taller.sql`](sql/002_perfil_taller.sql) (ejecutar en ese orden).
- **Mi taller:** el dueño edita nombre, RUC, dirección, teléfono y correo del taller, y sube su logo al bucket público `logos` (PNG/JPG/WEBP, máx. 1 MB, ruta `logos/<taller_id>/logo-<timestamp>.<ext>`). El logo y los datos aparecen en la barra superior y en el encabezado de la orden impresa; sin logo se usan las iniciales del taller.
- **Cliente de Supabase:** `@supabase/supabase-js@2.45.4` desde jsDelivr, con versión fija.
- **Multi-taller:** cada usuario pertenece a un taller. Las políticas RLS hacen que cada taller vea solo sus datos. El frontend **nunca** envía `taller_id` ni `numero`: los asigna la base.
- **Acceso:** correo y contraseña, o "Continuar con Google" (proveedor Google activado en Supabase → Authentication → Providers). Las cuentas creadas con Google no traen nombre de taller (el trigger lo crea como "Mi taller"), así que la app pide el nombre en una pantalla de bienvenida antes de dejar usarla. Si la sesión guardada es de un usuario que ya no existe o sin taller, la app cierra la sesión y vuelve al login con "Tu sesión expiró".
- **Demo:** al registrarse, un trigger crea el taller con `plan = 'demo'` y `trial_ends_at = now() + 7 días`. Cuando la demo vence, RLS bloquea los datos de trabajo y la app muestra la pantalla "Tu demo terminó". Los datos no se borran.

## Configuración (`config.js`)

```js
export const SUPABASE_URL = "https://<tu-proyecto>.supabase.co";
export const SUPABASE_ANON_KEY = "<anon o publishable key>";
```

La anon/publishable key es pública por diseño; la seguridad la dan las políticas RLS. **Nunca** pongas la `service_role` key en el frontend ni en este repositorio.

En Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://karenariasbme.github.io/zynthea-talleres/`
- **Redirect URLs:** `https://karenariasbme.github.io/zynthea-talleres/**`

Sin esto, los enlaces de confirmación de correo y de recuperación de contraseña redirigen a la URL por defecto (localhost).

## Estructura

```
index.html          Login, registro (demo 7 días) y recuperación de contraseña
app.html            App protegida (requiere sesión)
config.js           URL y anon key de Supabase
css/styles.css      Estilos (mobile-first, paleta "taller mecánico": grafito + naranja)
js/sb.js            Cliente de Supabase
js/util.js          Ayudas: creación segura de DOM, placas, fechas (America/Guayaquil), errores en español
js/ui.js            Componentes: tarjetas, formularios, ventanas, estados de carga/vacío
js/state.js         Estado compartido (taller actual)
js/login.js         Lógica de index.html
js/app.js           Arranque, sesión, demo/bloqueo y rutas (#inicio, #nueva, #orden/<id>, …)
js/views/           Pantallas: inicio (con buscador global), nueva orden, detalle/cerrar orden,
                    clientes, vehículos, historial, mi taller (datos, logo, plan y cuenta),
                    admin (panel de administración)
sql/001_esquema.sql Esquema de la base (tablas, RLS, triggers)
sql/002_perfil_taller.sql Datos de la empresa, logo y bucket "logos"
sql/004_observaciones.sql Observaciones generales en la orden
sql/005_panel_admin.sql   Admins, invitaciones, suspensión y funciones del panel
sql/006_estandar.sql      Plan Estándar: presupuestos, enlace público, reservas, costos, talleres internos
```

Todo el texto que viene de la base se pinta con nodos de texto (`textContent`), nunca con `innerHTML`.

## Plan Estándar

Base de datos: [`sql/003_estandar_items.sql`](sql/003_estandar_items.sql) (ya aplicado, reconstruido de la base) y [`sql/006_estandar.sql`](sql/006_estandar.sql).
Todo lo del Estándar exige plan `estandar` o superior en la base (`taller_estandar()` en RLS y `_plan_nivel()` en las funciones públicas).
En la demo y el Básico estas secciones se ven con candado y el botón "Mejorar plan" (WhatsApp).

- **Órdenes:** kilometraje de ingreso; mano de obra, repuestos y otros (cantidad × precio), IVA por orden (15 % por defecto) y total.
  Costo unitario opcional e interno: ganancia = venta sin IVA − costo; si falta algún costo, la orden cuenta solo como ingreso.
- **Envío:** "Enviar por WhatsApp" (wa.me con mensaje y enlace), "Enviar por correo" (mailto) y "Copiar enlace".
  El enlace público (`orden.html?t=…` / `presupuesto.html?t=…`) es de solo lectura, con un token aleatorio de 64 caracteres;
  muestra solo lo que sale en el documento impreso y, del cliente, solo el nombre. Nunca muestra costos.
- **Presupuestos** (`#presupuestos`): PR-0001 automático, mismos ítems e IVA, estados, envío y "Convertir en orden" (`convertir_presupuesto()`).
- **Reportes** (`#reportes/AAAA-MM`): órdenes entregadas en el mes (por fecha de salida), ingresos, IVA, total, costo y ganancia; descarga en Excel (SheetJS se carga solo al exportar).
- **Página de enlaces** (`enlaces.html?t=<slug>`): logo, WhatsApp, ubicación, TikTok (solo si tiene enlace) y reserva de turno, con el color de marca del taller. Se configura en Mi taller.
- **Reservas y Agenda** (`#agenda`): el formulario público solo llama a `horarios_disponibles()` y `reservar_turno()` (SECURITY DEFINER: fecha futura, horario y turnos del taller, cupos, 1 reserva activa por teléfono y día, límites anti-spam). No puede leer reservas ajenas.
- **Nombres de campos (todos los planes):** "Estado del vehículo al ingreso", "Salida del vehículo", "Observaciones del trabajo a realizar".

Las páginas públicas (`orden.html`, `presupuesto.html`, `enlaces.html`) llevan `noindex, nofollow` y `referrer: no-referrer` (el token no sale en el Referer).

## Panel de administración

Desde [`sql/005_panel_admin.sql`](sql/005_panel_admin.sql), las cuentas de `public.admins` entran directo al panel (`#admin/talleres`) en lugar de a su taller:

- **Talleres:** demos, demos vencidas, activos y suspendidos. Activar plan (la demo pasa al plan pagado con todos sus datos), cambiar plan, suspender (con motivo que ve el cliente) y reactivar.
- **Dar acceso:** si el correo ya tiene cuenta confirmada, activa su plan al momento; si no, crea una invitación que se aplica sola cuando se registra y confirma su correo.
- **Invitaciones:** pendientes, con opción de anular.

Cada acción queda en `admin_bitacora`. Un taller con plan pagado no se puede borrar (trigger `trg_talleres_proteger_plan`). Un taller suspendido ve la pantalla "Taller suspendido"; sus datos no se borran.

## Pasar un taller a plan pagado (SQL, alternativa al panel)

En Supabase → **SQL Editor**:

```sql
-- 1. Buscar el taller (por nombre o por el correo del dueño)
select t.id, t.nombre, t.plan, t.trial_ends_at, u.email
from talleres t
join miembros m on m.taller_id = t.id
join auth.users u on u.id = m.user_id
where u.email = 'correo@deltaller.com';

-- 2. Activar el plan
update talleres set plan = 'basico' where id = '<id-del-taller>';
```

Con un plan distinto de `demo`, la fecha `trial_ends_at` deja de aplicar y el taller recupera acceso a todos sus datos.

Para **extender una demo** en lugar de activarla:

```sql
update talleres set trial_ends_at = now() + interval '7 days' where id = '<id-del-taller>';
```

## Desarrollo local

No hay build. Sirve la carpeta con cualquier servidor estático, por ejemplo:

```bash
python -m http.server 8000
```

y abre http://localhost:8000/.
