import { sb } from "../sb.js";
import { h, must, val, formatPlaca, fmtFecha, toLocalInput, fromLocalInput, toast } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, textarea, asyncForm, userError, estadoBadge, empty } from "../ui.js";

async function cargar(id) {
  if (!id) return null;
  return must(await sb.from("historial_ordenes").select("*").eq("id", id).maybeSingle());
}

const noEncontrada = () =>
  empty("No encontramos esta orden.", h("a", { class: "btn primary", href: "#inicio" }, "Ir al inicio"));

const dato = (label, value) =>
  h("div", { class: "dato" }, h("dt", {}, label), h("dd", {}, value == null || value === "" ? "—" : value));

/** Datos de la orden en formato documento (también es la vista imprimible). */
export function ordenDoc(o) {
  return h("article", { class: "card print-doc" },
    h("header", { class: "doc-head" },
      h("div", {},
        h("p", { class: "doc-taller" }, state.taller?.nombre || ""),
        h("p", { class: "muted" }, "Orden de trabajo")),
      h("div", { class: "doc-code" }, h("span", {}, o.codigo), estadoBadge(o))),
    h("div", { class: "doc-cols" },
      h("section", {},
        h("h3", {}, "Cliente"),
        h("dl", {},
          dato("Nombre", o.cliente_nombre),
          dato("Cédula / RUC", o.cliente_cedula_ruc),
          dato("Teléfono", o.cliente_telefono))),
      h("section", {},
        h("h3", {}, "Vehículo"),
        h("dl", {},
          dato("Placa", formatPlaca(o.placa)),
          dato("Marca y modelo", `${o.marca} ${o.modelo}`),
          dato("Año", o.anio),
          dato("Color", o.color)))),
    h("section", {},
      h("h3", {}, "Trabajo"),
      h("dl", {},
        dato("Tipo de mantenimiento", o.tipo === "preventivo" ? "Preventivo" : "Correctivo"),
        dato("Motivo", o.motivo),
        dato("Descripción", o.descripcion))),
    h("div", { class: "doc-cols" },
      h("section", {},
        h("h3", {}, "Ingreso"),
        h("dl", {},
          dato("Fecha y hora", fmtFecha(o.fecha_ingreso)),
          dato("Cómo llegó", o.observacion_ingreso))),
      h("section", {},
        h("h3", {}, "Salida"),
        h("dl", {},
          dato("Fecha y hora", o.fecha_salida ? fmtFecha(o.fecha_salida) : "Pendiente"),
          dato("Cómo se va", o.observacion_salida)))),
    h("footer", { class: "doc-foot" },
      h("div", { class: "firma" }, "Firma del cliente"),
      h("div", { class: "firma" }, "Firma del taller")),
    h("p", { class: "doc-gen" }, `Impreso el ${fmtFecha(new Date().toISOString())} · Sistema para Talleres · Zynthea Solutions`));
}

export async function renderDetalle(box, id) {
  const o = await cargar(id);
  if (!o) return box.append(noEncontrada());
  const eid = encodeURIComponent(o.id);
  box.append(
    pageHead(`Orden ${o.codigo}`, `${formatPlaca(o.placa)} · ${o.cliente_nombre}`),
    h("div", { class: "actions no-print" },
      h("button", { class: "btn primary", type: "button", onclick: () => window.print() }, "Imprimir"),
      !o.fecha_salida && h("a", { class: "btn primary", href: `#cerrar/${eid}` }, "Cerrar orden"),
      h("a", { class: "btn ghost-dark", href: `#historial/${encodeURIComponent(o.placa)}` }, "Historial del vehículo")),
    ordenDoc(o));
}

export async function renderCerrar(box, id) {
  const o = await cargar(id);
  if (!o) return box.append(noEncontrada());
  const eid = encodeURIComponent(o.id);
  if (o.fecha_salida) {
    return box.append(
      pageHead(`Orden ${o.codigo}`),
      empty(`Esta orden ya se cerró el ${fmtFecha(o.fecha_salida)}.`,
        h("a", { class: "btn primary", href: `#orden/${eid}` }, "Ver la orden")));
  }

  const ingresoLocal = toLocalInput(new Date(o.fecha_ingreso));
  const form = asyncForm({ class: "card stack" }, [
    h("h2", {}, "Entrega del vehículo"),
    field("Fecha y hora de salida *", input({ name: "fecha_salida", type: "datetime-local", required: true,
      value: toLocalInput(), min: ingresoLocal, max: "2100-12-31T23:59" }),
      `Ingresó el ${fmtFecha(o.fecha_ingreso)}`),
    field("¿Cómo se va el vehículo?", textarea({ name: "observacion_salida", maxlength: 2000,
      placeholder: "Ej.: se entrega lavado, sin novedades" })),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "submit" }, "Cerrar orden"),
      h("a", { class: "btn ghost", href: `#orden/${eid}` }, "Cancelar")),
  ], async (fd) => {
    const salida = fd.get("fecha_salida");
    if (!salida) throw userError("Indica la fecha y hora de salida.");
    const iso = fromLocalInput(salida);
    if (new Date(iso) < new Date(o.fecha_ingreso))
      throw userError("La fecha de salida no puede ser anterior a la de ingreso.");
    must(await sb.from("ordenes_trabajo")
      .update({ fecha_salida: iso, observacion_salida: val(fd, "observacion_salida") })
      .eq("id", o.id).select("id").single());
    toast(`Orden ${o.codigo} cerrada`);
    location.hash = `#orden/${eid}`;
  });

  box.append(
    pageHead(`Cerrar ${o.codigo}`, `${formatPlaca(o.placa)} · ${o.marca} ${o.modelo} · ${o.cliente_nombre}`),
    h("div", { class: "card stack compact" },
      h("p", {}, h("b", {}, "Motivo: "), o.motivo),
      o.observacion_ingreso && h("p", { class: "muted" }, "Cómo llegó: ", o.observacion_ingreso)),
    form);
}
