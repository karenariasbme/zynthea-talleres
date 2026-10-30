import { sb } from "../sb.js";
import { h, must, val, formatPlaca, fmtFecha, toLocalInput, fromLocalInput, toast, errMsg } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, textarea, asyncForm, userError, estadoBadge, empty, tallerLogo } from "../ui.js";

async function cargar(id) {
  if (!id) return null;
  return must(await sb.from("historial_ordenes").select("*").eq("id", id).maybeSingle());
}

const noEncontrada = () =>
  empty("No encontramos esta orden.", h("a", { class: "btn primary", href: "#inicio" }, "Ir al inicio"));

const dato = (label, value) =>
  h("div", { class: "dato" }, h("dt", {}, label), h("dd", {}, value == null || value === "" ? "—" : value));

const tipoTexto = (t) => (t === "preventivo" ? "Preventivo" : "Correctivo");

/** Datos de la orden en formato documento (también es la vista imprimible). */
export function ordenDoc(o) {
  const t = state.taller || {};
  return h("article", { class: "card print-doc" },
    h("header", { class: "doc-head" },
      h("div", { class: "doc-brand" },
        tallerLogo(t, "doc"),
        h("div", {},
          h("p", { class: "doc-taller" }, t.nombre || ""),
          t.ruc && h("p", { class: "doc-line" }, `RUC: ${t.ruc}`),
          t.direccion && h("p", { class: "doc-line" }, t.direccion),
          (t.telefono || t.correo) && h("p", { class: "doc-line" }, [t.telefono, t.correo].filter(Boolean).join(" · ")))),
      h("div", { class: "doc-code" },
        h("span", { class: "doc-kind" }, "Orden de trabajo"),
        h("span", { class: "doc-num" }, o.codigo),
        estadoBadge(o))),
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
        dato("Tipo de mantenimiento", tipoTexto(o.tipo)),
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
    h("section", {},
      h("h3", {}, "Observaciones"),
      h("p", { class: "doc-obs" }, o.observaciones || "—")),
    h("footer", { class: "doc-foot" },
      h("div", { class: "firma" }, "Firma del cliente"),
      h("div", { class: "firma" }, "Firma del taller")),
    h("p", { class: "doc-gen" }, `Impreso el ${fmtFecha(new Date().toISOString())} · Desarrollado por Zynthea Solutions`));
}

export async function renderDetalle(box, id) {
  const o = await cargar(id);
  if (!o) return box.append(noEncontrada());
  const eid = encodeURIComponent(o.id);

  async function reabrir() {
    if (!confirm(`¿Reabrir la orden ${o.codigo}? Se quitará la fecha de salida y volverá a quedar abierta.`)) return;
    try {
      must(await sb.from("ordenes_trabajo").update({ fecha_salida: null }).eq("id", o.id).select("id").single());
      toast(`Orden ${o.codigo} reabierta`);
      state.refresh();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  box.append(
    pageHead(`Orden ${o.codigo}`, `${formatPlaca(o.placa)} · ${o.cliente_nombre}`),
    h("div", { class: "actions no-print" },
      h("button", { class: "btn primary", type: "button", onclick: () => window.print() }, "Imprimir"),
      h("a", { class: "btn ghost", href: `#editar/${eid}` }, "Editar"),
      o.fecha_salida
        ? h("button", { class: "btn ghost", type: "button", onclick: reabrir }, "Reabrir orden")
        : h("a", { class: "btn primary", href: `#cerrar/${eid}` }, "Cerrar orden"),
      h("a", { class: "btn ghost", href: `#historial/${encodeURIComponent(o.placa)}` }, "Historial del vehículo")),
    ordenDoc(o));
}

/** Valida que la salida no sea anterior al ingreso (también lo exige la base). */
function validarFechas(ingresoIso, salidaIso) {
  if (salidaIso && new Date(salidaIso) < new Date(ingresoIso))
    throw userError("La fecha de salida no puede ser anterior a la de ingreso.");
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

  const form = asyncForm({ class: "card stack" }, [
    h("h2", {}, "Entrega del vehículo"),
    field("Fecha y hora de salida *", input({ name: "fecha_salida", type: "datetime-local", required: true,
      value: toLocalInput(), min: toLocalInput(new Date(o.fecha_ingreso)), max: "2100-12-31T23:59" }),
      `Ingresó el ${fmtFecha(o.fecha_ingreso)}`),
    field("¿Cómo se va el vehículo?", textarea({ name: "observacion_salida", maxlength: 2000,
      placeholder: "Ej.: se entrega lavado, sin novedades" })),
    field("Observaciones", textarea({ name: "observaciones", maxlength: 2000, value: o.observaciones ?? "" })),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "submit" }, "Cerrar orden"),
      h("a", { class: "btn ghost", href: `#orden/${eid}` }, "Cancelar")),
  ], async (fd) => {
    if (!fd.get("fecha_salida")) throw userError("Indica la fecha y hora de salida.");
    const salida = fromLocalInput(fd.get("fecha_salida"));
    validarFechas(o.fecha_ingreso, salida);
    must(await sb.from("ordenes_trabajo")
      .update({ fecha_salida: salida, observacion_salida: val(fd, "observacion_salida"), observaciones: val(fd, "observaciones") })
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

/** Editar la orden: el código OT, el vehículo y el taller no se cambian. */
export async function renderEditar(box, id) {
  const o = await cargar(id);
  if (!o) return box.append(noEncontrada());
  const eid = encodeURIComponent(o.id);
  const cerrada = !!o.fecha_salida;

  const radio = (value, label) =>
    h("label", {}, h("input", { type: "radio", name: "tipo", value, checked: o.tipo === value }), label);

  const form = asyncForm({ class: "card stack" }, [
    h("div", { class: "field" }, h("span", { class: "field-label" }, "Tipo de mantenimiento *"),
      h("div", { class: "segmented" }, radio("preventivo", "Preventivo"), radio("correctivo", "Correctivo"))),
    field("Motivo *", input({ name: "motivo", required: true, maxlength: 200, value: o.motivo })),
    field("Descripción del trabajo", textarea({ name: "descripcion", maxlength: 2000, value: o.descripcion ?? "" })),
    field("Fecha y hora de ingreso *", input({ name: "fecha_ingreso", type: "datetime-local", required: true,
      value: toLocalInput(new Date(o.fecha_ingreso)), max: "2100-12-31T23:59" })),
    field("¿Cómo llegó el vehículo?", textarea({ name: "observacion_ingreso", maxlength: 2000, value: o.observacion_ingreso ?? "" })),
    cerrada && [
      field("Fecha y hora de salida *", input({ name: "fecha_salida", type: "datetime-local", required: true,
        value: toLocalInput(new Date(o.fecha_salida)), max: "2100-12-31T23:59" })),
      field("¿Cómo se va el vehículo?", textarea({ name: "observacion_salida", maxlength: 2000, value: o.observacion_salida ?? "" })),
    ],
    field("Observaciones", textarea({ name: "observaciones", maxlength: 2000, value: o.observaciones ?? "" })),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "submit" }, "Guardar cambios"),
      h("a", { class: "btn ghost", href: `#orden/${eid}` }, "Cancelar")),
  ], async (fd) => {
    const motivo = val(fd, "motivo");
    if (!fd.get("tipo")) throw userError("Elige si es mantenimiento preventivo o correctivo.");
    if (!motivo) throw userError("Escribe el motivo.");
    if (!fd.get("fecha_ingreso")) throw userError("Indica la fecha y hora de ingreso.");
    const cambios = {
      tipo: fd.get("tipo"),
      motivo,
      descripcion: val(fd, "descripcion"),
      fecha_ingreso: fromLocalInput(fd.get("fecha_ingreso")),
      observacion_ingreso: val(fd, "observacion_ingreso"),
      observaciones: val(fd, "observaciones"),
    };
    if (cerrada) {
      if (!fd.get("fecha_salida")) throw userError("Indica la fecha y hora de salida, o reabre la orden desde el detalle.");
      cambios.fecha_salida = fromLocalInput(fd.get("fecha_salida"));
      cambios.observacion_salida = val(fd, "observacion_salida");
      validarFechas(cambios.fecha_ingreso, cambios.fecha_salida);
    }
    must(await sb.from("ordenes_trabajo").update(cambios).eq("id", o.id).select("id").single());
    toast(`Orden ${o.codigo} actualizada`);
    location.hash = `#orden/${eid}`;
  });

  box.append(
    pageHead(`Editar ${o.codigo}`, `${formatPlaca(o.placa)} · ${o.marca} ${o.modelo} · ${o.cliente_nombre}`),
    h("p", { class: "note" }, cerrada
      ? "Orden entregada: también puedes corregir la salida. Para volver a abrirla usa «Reabrir orden» en el detalle."
      : "El código de la orden y el vehículo no se pueden cambiar."),
    form);
}
