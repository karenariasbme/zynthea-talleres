// Agenda (Plan Estándar): reservas de turno que llegan desde la página de enlaces del taller
// y reservas que el taller anota a mano. Solo las ve el propio taller (RLS).
import { sb } from "../sb.js";
import { h, must, val, toast, errMsg, formatPlaca, normPlaca, telWa, waUrl, hoyLocal, toLocalInput, fromLocalInput, tieneEstandar, TZ } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, textarea, openDialog, userError, empty, loading, errorBox, bloqueoEstandar } from "../ui.js";

export const ESTADOS_RES = { pendiente: "Pendiente", confirmada: "Confirmada", atendida: "Atendida", no_vino: "No vino", cancelada: "Cancelada" };
const ACTIVAS = ["pendiente", "confirmada"];

const fmtDia = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const fmtHora = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const diaLocal = (iso) => toLocalInput(new Date(iso)).slice(0, 10);

export async function render(box) {
  const t = state.taller;
  if (!tieneEstandar(t)) {
    return box.append(pageHead("Agenda"),
      bloqueoEstandar(t, "Agenda y reservas en línea",
        "Tus clientes reservan turno desde tu página de enlaces y tú los ves aquí, por día."));
  }

  const desde = input({ type: "date", value: hoyLocal(), "aria-label": "Desde" });
  const todas = h("input", { type: "checkbox" });
  const lista = h("div", { class: "stack-lg" }, loading());

  async function cargar() {
    lista.replaceChildren(loading());
    try {
      const inicio = fromLocalInput(`${desde.value || hoyLocal()}T00:00`);
      const fin = new Date(new Date(inicio).getTime() + 14 * 86400000).toISOString();
      let q = sb.from("reservas").select("*").gte("fecha_hora", inicio).lt("fecha_hora", fin).order("fecha_hora").limit(500);
      if (!todas.checked) q = q.in("estado", ACTIVAS);
      pintar(must(await q));
    } catch (e) {
      lista.replaceChildren(errorBox(errMsg(e)));
    }
  }

  function pintar(rs) {
    if (!rs.length) return lista.replaceChildren(empty(todas.checked
      ? "No hay reservas en las próximas 2 semanas."
      : "No hay reservas pendientes ni confirmadas en las próximas 2 semanas."));
    const dias = new Map();
    for (const r of rs) {
      const d = diaLocal(r.fecha_hora);
      if (!dias.has(d)) dias.set(d, []);
      dias.get(d).push(r);
    }
    lista.replaceChildren(...[...dias.values()].map((del) => h("section", { class: "section-block" },
      h("h2", { class: "block-title agenda-dia" }, fmtDia.format(new Date(del[0].fecha_hora)), " ",
        h("span", { class: "count" }, String(del.length))),
      h("div", { class: "list" }, del.map(tarjeta)))));
  }

  async function cambiar(r, estado) {
    try {
      must(await sb.from("reservas").update({ estado }).eq("id", r.id).select("id").single());
      toast(`${r.nombre}: ${ESTADOS_RES[estado]}`);
      await cargar();
    } catch (e) { toast(errMsg(e), "error"); }
  }

  function tarjeta(r) {
    const hora = fmtHora.format(new Date(r.fecha_hora));
    const msg = `Hola ${r.nombre.split(" ")[0]}, le saluda ${t.nombre}. Confirmamos su turno el ${fmtDia.format(new Date(r.fecha_hora))} a las ${hora}.`;
    const b = (txt, estado, cls = "ghost") => h("button", { class: `btn small ${cls}`, type: "button", onclick: () => cambiar(r, estado) }, txt);
    return h("article", { class: `card item reserva est-${r.estado}` },
      h("span", { class: "reserva-hora" }, hora),
      h("div", { class: "item-main" },
        h("b", {}, r.nombre),
        h("div", { class: "muted" }, [r.telefono, r.placa && formatPlaca(r.placa), r.origen === "web" ? "reservó en línea" : "anotada en el taller"].filter(Boolean).join(" · ")),
        r.motivo && h("div", {}, r.motivo),
        h("span", { class: `badge res-${r.estado}` }, ESTADOS_RES[r.estado])),
      h("div", { class: "item-actions" },
        telWa(r.telefono) && h("a", { class: "btn small whatsapp", href: waUrl(r.telefono, msg), target: "_blank", rel: "noopener" }, "WhatsApp"),
        r.estado === "pendiente" && b("Confirmar", "confirmada", "primary"),
        ACTIVAS.includes(r.estado) && b("Atendida", "atendida"),
        ACTIVAS.includes(r.estado) && b("No vino", "no_vino"),
        ACTIVAS.includes(r.estado) && b("Cancelar", "cancelada", "danger"),
        !ACTIVAS.includes(r.estado) && b("Reactivar", "pendiente")));
  }

  function nueva() {
    const body = h("div", { class: "stack" },
      field("Fecha y hora *", input({ name: "fecha_hora", type: "datetime-local", required: true, value: toLocalInput() })),
      field("Nombre del cliente *", input({ name: "nombre", required: true, maxlength: 120 })),
      field("Teléfono *", input({ name: "telefono", type: "tel", required: true, maxlength: 20 })),
      field("Placa", input({ name: "placa", maxlength: 12, class: "input plate-input", autocapitalize: "characters" })),
      field("Motivo", textarea({ name: "motivo", maxlength: 300 })));
    openDialog("Anotar reserva", body, {
      submitLabel: "Guardar",
      onSubmit: async (fd) => {
        const nombre = val(fd, "nombre");
        const telefono = (fd.get("telefono") || "").replace(/\D/g, "");
        if (!fd.get("fecha_hora")) throw userError("Indica la fecha y hora.");
        if (!nombre) throw userError("Escribe el nombre del cliente.");
        if (!/^\d{9,15}$/.test(telefono)) throw userError("Escribe un teléfono válido (9 a 15 dígitos).");
        must(await sb.from("reservas").insert({
          fecha_hora: fromLocalInput(fd.get("fecha_hora")), nombre, telefono,
          placa: normPlaca(fd.get("placa")) || null, motivo: val(fd, "motivo"), estado: "confirmada", origen: "app",
        }).select("id").single());
        toast("Reserva anotada");
        await cargar();
      },
    });
  }

  desde.addEventListener("change", cargar);
  todas.addEventListener("change", cargar);
  const aviso = !t.reservas_activas || !t.slug
    ? h("p", { class: "msg warn" }, "Tu formulario de reservas en línea está apagado. Actívalo en ",
        h("a", { href: "#taller" }, "Mi taller → Página de enlaces y reservas"), ".")
    : null;

  box.append(
    pageHead("Agenda", "Reservas de turno de las próximas 2 semanas",
      h("button", { class: "btn primary", type: "button", onclick: nueva }, "+ Anotar reserva")),
    aviso ?? "",
    h("div", { class: "toolbar row agenda-tools" },
      h("label", { class: "field-label" }, "Desde ", desde),
      h("label", { class: "check" }, todas, " Ver también atendidas, canceladas y no vino")),
    lista);
  await cargar();
}
