import { sb } from "../sb.js";
import { h, must, val, num, formatPlaca, fmtFecha, toLocalInput, fromLocalInput, toast, errMsg, tieneEstandar } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, textarea, asyncForm, userError, estadoBadge, empty, bloqueoEstandar } from "../ui.js";
import { documento, ETQ } from "../documento.js";
import { itemsEditor } from "../items.js";
import { botonesEnvio } from "../envio.js";

async function cargar(id) {
  if (!id) return null;
  return must(await sb.from("historial_ordenes").select("*").eq("id", id).maybeSingle());
}

const noEncontrada = () =>
  empty("No encontramos esta orden.", h("a", { class: "btn primary", href: "#inicio" }, "Ir al inicio"));

/** Datos de la orden en el formato del documento compartido (app y página pública). */
function datosDoc(o, extra) {
  return {
    tipoDoc: "orden",
    taller: state.taller,
    codigo: o.codigo,
    badge: estadoBadge(o),
    cliente: { nombre: o.cliente_nombre, cedula_ruc: o.cliente_cedula_ruc, telefono: o.cliente_telefono },
    vehiculo: { placa: o.placa, marca: o.marca, modelo: o.modelo, anio: o.anio, color: o.color },
    tipo: o.tipo, motivo: o.motivo, descripcion: o.descripcion, ocultarDescripcionVacia: tieneEstandar(state.taller),
    fecha_ingreso: o.fecha_ingreso, kilometraje_ingreso: o.kilometraje_ingreso, observacion_ingreso: o.observacion_ingreso,
    fecha_salida: o.fecha_salida, observacion_salida: o.observacion_salida, observaciones: o.observaciones,
    items: extra?.items || [], totales: extra?.totales, aplica_iva: extra?.iva?.aplica_iva, iva_porcentaje: extra?.iva?.iva_porcentaje,
    datos_pago: tieneEstandar(state.taller) ? state.taller.datos_pago : null,
    pie: `Impreso el ${fmtFecha(new Date().toISOString())} · Desarrollado por Zynthea Solutions`,
  };
}

export async function renderDetalle(box, id) {
  const o = await cargar(id);
  if (!o) return box.append(noEncontrada());
  const eid = encodeURIComponent(o.id);
  const estandar = tieneEstandar(state.taller);

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

  const docBox = h("div", {}, documento(datosDoc(o)));
  const envioBox = h("div", { class: "no-print" });
  let itemsEl;

  if (estandar) {
    // Token del enlace público y correo del cliente (no están en la vista del historial)
    const [rt, rc] = await Promise.all([
      sb.from("ordenes_trabajo").select("token_publico").eq("id", o.id).single(),
      sb.from("clientes").select("correo").eq("id", o.cliente_id).maybeSingle(),
    ]);
    const token = must(rt).token_publico;
    const correo = must(rc)?.correo;
    const ed = itemsEditor({
      tabla: "orden_items", fk: "orden_id", id: o.id, padre: "ordenes_trabajo",
      vistaTotales: "ordenes_totales", idTotales: "orden_id", conCostos: true,
      onCambio: (d) => {
        docBox.replaceChildren(documento(datosDoc(o, d)));
        envioBox.replaceChildren(botonesEnvio({
          taller: state.taller, tipoDoc: "orden", codigo: o.codigo, placa: o.placa, token,
          docEl: () => docBox.querySelector(".print-doc"),
          cliente: { id: o.cliente_id, nombre: o.cliente_nombre, telefono: o.cliente_telefono, correo }, total: d.totales?.total,
        }));
      },
    });
    itemsEl = h("div", { class: "no-print" }, ed.el);
    await ed.cargar();
  } else {
    itemsEl = h("div", { class: "card stack no-print" },
      bloqueoEstandar(state.taller, "Mano de obra y repuestos con IVA", null, { compacto: true }),
      bloqueoEstandar(state.taller, "Enviar por WhatsApp o correo", null, { compacto: true }));
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
    itemsEl,
    envioBox,
    docBox);
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
    field(ETQ.salida, textarea({ name: "observacion_salida", maxlength: 2000,
      placeholder: "Ej.: se entrega lavado, sin novedades" })),
    field(ETQ.observaciones, textarea({ name: "observaciones", maxlength: 2000, value: o.observaciones ?? "" })),
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
      o.observacion_ingreso && h("p", { class: "muted" }, `${ETQ.ingreso}: `, o.observacion_ingreso)),
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
    !tieneEstandar(state.taller) && field("Descripción del trabajo", textarea({ name: "descripcion", maxlength: 2000, value: o.descripcion ?? "" })),
    field("Fecha y hora de ingreso *", input({ name: "fecha_ingreso", type: "datetime-local", required: true,
      value: toLocalInput(new Date(o.fecha_ingreso)), max: "2100-12-31T23:59" })),
    tieneEstandar(state.taller) && field(ETQ.km, input({ name: "kilometraje_ingreso", type: "number", min: 0, max: 3000000,
      inputmode: "numeric", value: o.kilometraje_ingreso ?? "" })),
    field(ETQ.ingreso, textarea({ name: "observacion_ingreso", maxlength: 2000, value: o.observacion_ingreso ?? "" })),
    cerrada && [
      field("Fecha y hora de salida *", input({ name: "fecha_salida", type: "datetime-local", required: true,
        value: toLocalInput(new Date(o.fecha_salida)), max: "2100-12-31T23:59" })),
      field(ETQ.salida, textarea({ name: "observacion_salida", maxlength: 2000, value: o.observacion_salida ?? "" })),
    ],
    field(ETQ.observaciones, textarea({ name: "observaciones", maxlength: 2000, value: o.observaciones ?? "" })),
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
      fecha_ingreso: fromLocalInput(fd.get("fecha_ingreso")),
      observacion_ingreso: val(fd, "observacion_ingreso"),
      observaciones: val(fd, "observaciones"),
    };
    if (tieneEstandar(state.taller)) {
      // En el Estándar no se envía "descripcion": la que ya tenga la orden se conserva.
      const km = num(fd, "kilometraje_ingreso");
      if (Number.isNaN(km) || km < 0 || km > 3000000) throw userError("El kilometraje debe ser un número entre 0 y 3.000.000.");
      cambios.kilometraje_ingreso = km == null ? null : Math.round(km);
    } else {
      cambios.descripcion = val(fd, "descripcion");
    }
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
