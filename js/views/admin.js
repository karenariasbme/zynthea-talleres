// Panel de administración. Solo lo ve una cuenta de public.admins (es_admin() = true).
// La seguridad está en la base: cada función admin_* comprueba es_admin() y rechaza a cualquier otro usuario.
import { sb } from "../sb.js";
import { h, val, toast, errMsg, fmtFecha, PLANES } from "../util.js";
import { pageHead, field, input, asyncForm, userError, loading, errorBox, empty, openDialog } from "../ui.js";

const TABS = [
  ["talleres", "Talleres"],
  ["dar", "Dar acceso"],
  ["invitaciones", "Invitaciones"],
];

const PAGADOS = ["basico", "estandar", "profesional", "premium"];

const ESTADOS = {
  demo: ["Demo", "demo"],
  demo_vencida: ["Demo vencida", "vencida"],
  activo: ["Activo", "activo"],
  suspendido: ["Suspendido", "suspendido"],
};

const FILTROS = [
  ["todos", "Todos"],
  ["demo", "Demo"],
  ["demo_vencida", "Demo vencida"],
  ["activo", "Activos"],
  ["suspendido", "Suspendidos"],
];

/** Llama a una función admin_*. Los errores de validación de la base se muestran tal cual (ya están en español). */
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    if (["22023", "P0002", "42501"].includes(error.code)) throw userError(error.message);
    throw error;
  }
  return data;
}

const planSelect = (valor = "basico") =>
  h("select", { class: "input", name: "plan", required: true },
    PAGADOS.map((k) => h("option", { value: k, selected: k === valor }, PLANES[k])));

const s = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// ---------- Panel ----------
export async function render(box, arg) {
  const actual = TABS.some(([k]) => k === arg) ? arg : "talleres";
  const contenido = h("div", { class: "admin-body" }, loading());
  const tabs = h("nav", { class: "admin-tabs", "aria-label": "Secciones del panel" },
    TABS.map(([k, n]) => h("a", { href: `#admin/${k}`, "aria-current": k === actual ? "page" : null, "data-tab": k },
      n, h("span", { class: "count", hidden: true }))));

  box.append(pageHead("Panel de administración", "Demos, clientes, planes e invitaciones"), tabs, contenido);

  // Contador de invitaciones pendientes (no detiene la pantalla si falla)
  const contar = async () => {
    const { data, error } = await sb.rpc("admin_invitaciones");
    if (error) return;
    const el = tabs.querySelector('[data-tab="invitaciones"] .count');
    el.textContent = data.length;
    el.hidden = !data.length;
  };

  const recargar = async () => {
    contar();
    try {
      contenido.replaceChildren(await VISTAS[actual]({ recargar, contar }));
    } catch (e) {
      contenido.replaceChildren(errorBox(e.userMessage || errMsg(e)));
    }
  };
  await recargar();
}

const VISTAS = {
  // 1. Demos y clientes
  async talleres({ recargar }) {
    const lista = await rpc("admin_talleres");
    if (!lista.length) return empty("Todavía no hay talleres registrados.");

    const n = (e) => lista.filter((t) => t.estado === e).length;
    let filtro = "todos";
    const buscar = input({ type: "search", placeholder: "Buscar por taller, correo o teléfono", "aria-label": "Buscar taller" });
    const chips = h("div", { class: "chips", role: "group", "aria-label": "Filtrar por estado" },
      FILTROS.map(([k, nombre]) => h("button", {
        class: "chip", type: "button", "aria-pressed": String(k === filtro), "data-f": k,
        onclick: () => {
          filtro = k;
          for (const c of chips.children) c.setAttribute("aria-pressed", String(c.dataset.f === k));
          aplicar();
        },
      }, nombre, " ", h("span", { class: "muted" }, String(k === "todos" ? lista.length : n(k))))));

    const items = lista.map((t) => ({ t, el: tallerCard(t, recargar) }));
    const sinResultados = h("p", { class: "note", hidden: true }, "Ningún taller coincide.");
    function aplicar() {
      const q = buscar.value.trim().toLowerCase();
      let visibles = 0;
      for (const { t, el } of items) {
        const ok = (filtro === "todos" || t.estado === filtro)
          && (!q || `${t.nombre} ${t.dueno_email || ""} ${t.telefono || ""}`.toLowerCase().includes(q));
        el.hidden = !ok;
        if (ok) visibles++;
      }
      sinResultados.hidden = visibles > 0;
    }
    buscar.addEventListener("input", aplicar);

    return h("div", { class: "stack" },
      buscar, chips,
      h("div", { class: "list" }, items.map((x) => x.el)),
      sinResultados);
  },

  // 2. Dar acceso por correo
  async dar({ contar }) {
    const resultado = h("p", { class: "msg ok", role: "status", hidden: true });
    const form = asyncForm({ class: "stack" }, [
      field("Correo del cliente *", input({ name: "email", type: "email", required: true, autocomplete: "off", inputmode: "email", spellcheck: "false" })),
      field("Plan *", planSelect()),
      field("Nombre del taller *", input({ name: "nombre", required: true, maxlength: 120 }),
        "Solo se usa si todavía no se registra. Si ya tiene taller, conserva el nombre que puso."),
      h("button", { class: "btn primary", type: "submit" }, "Dar acceso"),
    ], async (fd, f) => {
      const email = val(fd, "email"), nombre = val(fd, "nombre");
      if (!email || !nombre) throw userError("Completa el correo y el nombre del taller.");
      resultado.hidden = true;
      const r = await rpc("admin_dar_acceso", { p_email: email, p_plan: fd.get("plan"), p_nombre: nombre });
      resultado.textContent = r.resultado === "activado"
        ? `✅ Plan ${PLANES[r.plan]} activado para ${email}. Su taller conserva todos los datos de la demo.`
        : `📨 Invitación creada: cuando ${email} se registre y confirme su correo, su taller quedará con el plan ${PLANES[r.plan]}.`;
      resultado.hidden = false;
      f.reset();
      contar();
    });
    return h("div", { class: "card admin-form stack" },
      h("p", { class: "note" },
        "Si el correo ya tiene cuenta (demo), se activa el plan al momento. Si todavía no se registra, queda una invitación que se aplica sola al registrarse."),
      form, resultado);
  },

  // 3. Invitaciones pendientes
  async invitaciones({ recargar }) {
    const lista = await rpc("admin_invitaciones");
    if (!lista.length) return empty("No hay invitaciones pendientes.");
    return h("div", { class: "list" }, lista.map((i) => h("article", { class: "card item" },
      h("div", { class: "item-main" },
        h("div", { class: "admin-head" }, h("strong", {}, i.email), h("span", { class: "badge activo" }, PLANES[i.plan] || i.plan)),
        h("p", {}, i.nombre),
        h("p", { class: "note" }, `Creada el ${fmtFecha(i.created_at)} · se aplica sola cuando se registre con ese correo.`)),
      h("div", { class: "item-actions" },
        h("button", { class: "btn small danger", type: "button", onclick: () => confirmar({
          titulo: "Anular invitación", texto: `${i.email} · ${i.nombre} (${PLANES[i.plan]}). Si se registra después, empezará con la demo de 7 días.`,
          boton: "Anular",
          accion: async () => {
            await rpc("admin_anular_invitacion", { p_id: i.id });
            return `Invitación anulada: ${i.email}`;
          }, recargar }) }, "Anular")))));
  },
};

function tallerCard(t, recargar) {
  const [estado, clase] = ESTADOS[t.estado] || [t.estado, ""];
  const demo = t.plan === "demo";
  const detalle = [s(t.ordenes, "orden", "órdenes")];
  if (t.ultima_orden) detalle.push(`última el ${fmtFecha(t.ultima_orden)}`);
  if (demo) detalle.push(`${t.estado === "demo_vencida" ? "venció" : "vence"} el ${fmtFecha(t.trial_ends_at)}`);
  else if (t.plan_desde) detalle.push(`plan desde el ${fmtFecha(t.plan_desde)}`);
  detalle.push(`registrado el ${fmtFecha(t.created_at)}`);

  const quien = `${t.nombre} · ${t.dueno_email || "sin dueño"}`;
  const acciones = [];

  if (demo) {
    acciones.push(h("button", { class: "btn small primary", type: "button", onclick: () => elegirPlan({
      titulo: "Activar plan", texto: `${quien}. Se conservan todos sus clientes, vehículos y órdenes de la demo.`,
      boton: "Activar plan", fn: "admin_activar_plan", t, recargar }) }, "Activar plan"));
  } else {
    acciones.push(h("button", { class: "btn small ghost", type: "button", onclick: () => elegirPlan({
      titulo: "Cambiar plan", texto: `${quien} · plan actual: ${PLANES[t.plan] || t.plan}.`,
      boton: "Cambiar plan", fn: "admin_cambiar_plan", t, recargar }) }, "Cambiar plan"));
  }

  if (t.suspendido_at) {
    acciones.push(h("button", { class: "btn small primary", type: "button", onclick: () => confirmar({
      titulo: "Reactivar taller",
      texto: `${quien}. Podrá volver a entrar y verá todos sus datos.`
        + (t.plan === "demo" && new Date(t.trial_ends_at) <= new Date() ? " Ojo: su demo ya venció, así que seguirá bloqueado hasta que actives un plan." : ""),
      boton: "Reactivar",
      accion: async () => {
        await rpc("admin_reactivar", { p_taller: t.taller_id });
        return `Reactivado: ${t.nombre}`;
      }, recargar }) }, "Reactivar"));
  } else {
    acciones.push(h("button", { class: "btn small danger", type: "button", onclick: () => {
      const nota = h("textarea", { class: "input", name: "nota", rows: 3, maxlength: 300 });
      openDialog("Suspender taller", h("div", { class: "stack" },
        h("p", {}, `${quien}. Nadie de este taller podrá usar la app. Sus datos no se borran: con Reactivar vuelve todo como estaba.`),
        field("Motivo (opcional)", nota, "Lo verá el cliente al entrar.")), {
        submitLabel: "Suspender",
        onSubmit: async (fd) => {
          await rpc("admin_suspender", { p_taller: t.taller_id, p_nota: val(fd, "nota") });
          toast(`Suspendido: ${t.nombre}`);
          await recargar();
        },
      });
    } }, "Suspender"));
  }

  return h("article", { class: "card item" },
    h("div", { class: "item-main" },
      h("div", { class: "admin-head" },
        h("strong", {}, t.nombre),
        h("span", { class: `badge ${clase}` }, estado),
        !demo && h("span", { class: "muted" }, PLANES[t.plan] || t.plan)),
      h("p", { class: "note" }, [t.dueno_email || "Sin dueño", t.telefono].filter(Boolean).join(" · ")),
      h("p", { class: "note" }, detalle.join(" · ")),
      t.suspendido_at && h("p", { class: "msg warn" },
        `Suspendido el ${fmtFecha(t.suspendido_at)}`, t.nota_suspension ? `: ${t.nota_suspension}` : "")),
    h("div", { class: "item-actions" }, acciones));
}

/** Ventana con selector de plan (activar o cambiar). */
function elegirPlan({ titulo, texto, boton, fn, t, recargar }) {
  const valor = t.plan === "demo" ? "basico" : t.plan;
  openDialog(titulo, h("div", { class: "stack" }, h("p", {}, texto), field("Plan", planSelect(valor))), {
    submitLabel: boton,
    onSubmit: async (fd) => {
      const plan = fd.get("plan");
      if (plan === t.plan) throw userError("Ese ya es su plan.");
      await rpc(fn, { p_taller: t.taller_id, p_plan: plan });
      toast(`${t.nombre}: plan ${PLANES[plan]}`);
      await recargar();
    },
  });
}

/** Ventana de confirmación simple. */
function confirmar({ titulo, texto, boton, accion, recargar }) {
  openDialog(titulo, h("p", {}, texto), {
    submitLabel: boton,
    onSubmit: async () => {
      toast(await accion());
      await recargar();
    },
  });
}
