// Presupuestos (Plan Estándar): PR-0001 automático, mano de obra y repuestos con IVA,
// envío por WhatsApp/correo con enlace público y "Convertir en orden".
import { sb } from "../sb.js";
import { h, must, val, num, formatPlaca, fmtFecha, toast, errMsg, usd, tieneEstandar } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, textarea, asyncForm, userError, empty, loading, errorBox, openDialog, bloqueoEstandar } from "../ui.js";
import { cargarIndice, buscarEnIndice } from "../buscar.js";
import { documento, ETQ } from "../documento.js";
import { itemsEditor } from "../items.js";
import { botonesEnvio } from "../envio.js";

export const ESTADOS_PR = {
  borrador: "Borrador", enviado: "Enviado", aprobado: "Aprobado", rechazado: "Rechazado", convertido: "Convertido en orden",
};
const PR_COLS = "id,codigo,numero,cliente_id,vehiculo_id,motivo,descripcion,observaciones,validez_dias,aplica_iva,iva_porcentaje,estado,orden_id,token_publico,created_at";

const bloqueado = (box) => box.append(pageHead("Presupuestos"),
  bloqueoEstandar(state.taller, "Presupuestos profesionales",
    "Arma presupuestos con mano de obra y repuestos, envíalos por WhatsApp o correo y conviértelos en orden con un toque."));

const badgePr = (estado) => h("span", { class: `badge pr-${estado}` }, ESTADOS_PR[estado] || estado);

// ---------- Lista ----------
export async function renderLista(box) {
  if (!tieneEstandar(state.taller)) return bloqueado(box);
  const [rp, rc, rv, rt] = await Promise.all([
    sb.from("presupuestos").select(PR_COLS).order("numero", { ascending: false }).limit(300),
    sb.from("clientes").select("id,nombre").limit(5000),
    sb.from("vehiculos").select("id,placa,marca,modelo").limit(5000),
    sb.from("presupuestos_totales").select("presupuesto_id,total").limit(300),
  ]);
  const lista = must(rp);
  const cli = new Map(must(rc).map((c) => [c.id, c]));
  const veh = new Map(must(rv).map((v) => [v.id, v]));
  const tot = new Map(must(rt).map((t) => [t.presupuesto_id, t.total]));

  const buscar = input({ type: "search", placeholder: "Buscar por código, cliente, placa o motivo", "aria-label": "Buscar presupuesto" });
  const cont = h("div", { class: "list" });
  const pintar = () => {
    const q = buscar.value.trim().toLowerCase();
    const vis = lista.filter((p) => {
      const v = veh.get(p.vehiculo_id);
      return !q || `${p.codigo} ${cli.get(p.cliente_id)?.nombre || ""} ${v?.placa || ""} ${p.motivo}`.toLowerCase().includes(q);
    });
    cont.replaceChildren(...(vis.length ? vis.map((p) => {
      const v = veh.get(p.vehiculo_id);
      return h("a", { class: "card item pr-row", href: `#presupuesto/${encodeURIComponent(p.id)}` },
        h("span", { class: "ot-code" }, p.codigo),
        h("div", { class: "item-main" },
          h("b", {}, cli.get(p.cliente_id)?.nombre || "—"),
          h("div", { class: "muted" }, [v && `${formatPlaca(v.placa)} ${v.marca} ${v.modelo}`, p.motivo, fmtFecha(p.created_at)].filter(Boolean).join(" · "))),
        h("b", { class: "pr-total" }, usd(tot.get(p.id))),
        badgePr(p.estado));
    }) : [empty(lista.length ? "Ningún presupuesto coincide." : "Todavía no tienes presupuestos.",
        !lista.length && h("a", { class: "btn primary", href: "#nuevo-presupuesto" }, "Crear el primero"))]));
  };
  buscar.addEventListener("input", pintar);
  pintar();
  box.append(
    pageHead("Presupuestos", "Cotizaciones para tus clientes", h("a", { class: "btn primary", href: "#nuevo-presupuesto" }, "+ Nuevo presupuesto")),
    h("div", { class: "toolbar" }, buscar),
    cont);
}

// ---------- Nuevo / editar ----------
/** Selector de cliente (existente o nuevo) y vehículo opcional de ese cliente. */
function selectorCliente(idx, inicial) {
  let cliente = inicial?.cliente || null;
  let vehiculoId = inicial?.vehiculo_id || null;
  const q = input({ type: "search", placeholder: "Buscar cliente por nombre, cédula o placa", "aria-label": "Buscar cliente", autocomplete: "off" });
  const res = h("div", { class: "search-results" });
  const fijo = h("div");
  const nuevo = h("div", { class: "stack" },
    field("Nombre o razón social *", input({ name: "c_nombre", maxlength: 120 })),
    h("div", { class: "cols" },
      field("Cédula / RUC", input({ name: "c_cedula", inputmode: "numeric", maxlength: 13 })),
      field("Teléfono", input({ name: "c_telefono", type: "tel", maxlength: 20 }))),
    field("Correo", input({ name: "c_correo", type: "email", maxlength: 120 })));
  const vehBox = h("div");

  function pintar() {
    fijo.replaceChildren(...(cliente ? [h("div", { class: "locked-block" },
      h("div", { class: "locked-info" }, h("b", {}, cliente.nombre),
        h("span", { class: "muted" }, [cliente.cedula_ruc, cliente.telefono, cliente.correo].filter(Boolean).join(" · ") || "Sin datos de contacto")),
      !inicial && h("button", { class: "btn small ghost", type: "button", onclick: () => { cliente = null; vehiculoId = null; pintar(); } }, "Cambiar"))] : []));
    nuevo.hidden = !!cliente;
    q.hidden = !!cliente || !!inicial;
    const propios = cliente ? idx.vehiculos.filter((v) => v.cliente_id === cliente.id) : [];
    vehBox.replaceChildren(...(cliente ? [
      field("Vehículo (opcional; obligatorio para convertir en orden)",
        h("select", { class: "input", name: "vehiculo_id", value: vehiculoId || "",
          onchange: (e) => { vehiculoId = e.target.value || null; } },
          h("option", { value: "" }, propios.length ? "Sin vehículo" : "El cliente no tiene vehículos registrados"),
          propios.map((v) => h("option", { value: v.id }, `${formatPlaca(v.placa)} · ${v.marca} ${v.modelo}`)))),
    ] : [h("p", { class: "note" }, "Para elegir un vehículo, primero elige un cliente registrado. Puedes asignarlo después.")]));
  }
  q.addEventListener("input", () => {
    const t = q.value.trim();
    if (t.length < 2) return res.replaceChildren();
    const r = buscarEnIndice(idx, t, 8);
    const clientes = [...new Map([...r.clientes, ...r.vehiculos.map((v) => v.cliente).filter(Boolean)].map((c) => [c.id, c])).values()];
    res.replaceChildren(...(clientes.length ? clientes.map((c) => h("button", { class: "result", type: "button",
      onclick: () => { cliente = c; vehiculoId = null; q.value = ""; res.replaceChildren(); pintar(); } },
      h("span", { class: "result-main" }, h("b", {}, c.nombre), h("span", { class: "muted" }, c.cedula_ruc || "")),
      h("span", { class: "result-go" }, "Elegir"))) : [h("p", { class: "note" }, "Sin coincidencias: completa los datos del cliente nuevo.")]));
  });
  pintar();
  return {
    el: h("div", { class: "card stack" }, h("h2", {}, "Cliente y vehículo"), q, res, fijo, nuevo, vehBox),
    get cliente() { return cliente; },
    get vehiculoId() { return vehiculoId; },
  };
}

const camposPresupuesto = (p) => [
  field("Motivo *", input({ name: "motivo", maxlength: 300, required: true, value: p?.motivo ?? "", placeholder: "Ej.: mantenimiento de 50.000 km" })),
  field(ETQ.observaciones, textarea({ name: "observaciones", maxlength: 2000, value: p?.observaciones ?? "",
    placeholder: "Condiciones, tiempo estimado, garantía…" })),
  field("Validez (días) *", input({ name: "validez_dias", type: "number", min: 1, max: 365, required: true, value: p?.validez_dias ?? 15 })),
];

function leerCampos(fd) {
  const motivo = val(fd, "motivo");
  const validez = num(fd, "validez_dias");
  if (!motivo) throw userError("Escribe el motivo del presupuesto.");
  if (!(validez >= 1 && validez <= 365)) throw userError("La validez debe estar entre 1 y 365 días.");
  return { motivo, observaciones: val(fd, "observaciones"), validez_dias: Math.round(validez) };
}

export async function renderNuevo(box) {
  if (!tieneEstandar(state.taller)) return bloqueado(box);
  const idx = await cargarIndice();
  const sel = selectorCliente(idx);
  const form = asyncForm({ class: "stack-lg", novalidate: true }, [
    sel.el,
    h("div", { class: "card stack" }, h("h2", {}, "Presupuesto"), ...camposPresupuesto(null),
      h("button", { class: "btn primary block", type: "submit" }, "Crear presupuesto")),
  ], async (fd) => {
    const datos = leerCampos(fd);
    let cliente = sel.cliente;
    if (!cliente) {
      const nombre = val(fd, "c_nombre");
      if (!nombre) throw userError("Elige un cliente registrado o escribe el nombre del cliente nuevo.");
      cliente = must(await sb.from("clientes").insert({ nombre, cedula_ruc: val(fd, "c_cedula"),
        telefono: val(fd, "c_telefono"), correo: val(fd, "c_correo") }).select("id").single());
    }
    const p = must(await sb.from("presupuestos").insert({ ...datos, cliente_id: cliente.id, vehiculo_id: sel.vehiculoId })
      .select("id,codigo").single());
    toast(`Presupuesto ${p.codigo} creado: agrega mano de obra y repuestos`);
    location.hash = `#presupuesto/${encodeURIComponent(p.id)}`;
  });
  box.append(pageHead("Nuevo presupuesto", "Después agregas la mano de obra y los repuestos"), form);
}

async function cargarPr(id) {
  if (!id) return null;
  const p = must(await sb.from("presupuestos").select(PR_COLS).eq("id", id).maybeSingle());
  if (!p) return null;
  const [rc, rv] = await Promise.all([
    sb.from("clientes").select("id,nombre,cedula_ruc,telefono,correo").eq("id", p.cliente_id).single(),
    p.vehiculo_id ? sb.from("vehiculos").select("id,placa,marca,modelo,anio,color").eq("id", p.vehiculo_id).single()
                  : Promise.resolve({ data: null, error: null }),
  ]);
  return { ...p, cliente: must(rc), vehiculo: must(rv) };
}

const noEncontrado = () => empty("No encontramos este presupuesto.", h("a", { class: "btn primary", href: "#presupuestos" }, "Ver presupuestos"));

export async function renderEditar(box, id) {
  if (!tieneEstandar(state.taller)) return bloqueado(box);
  const p = await cargarPr(id);
  if (!p) return box.append(noEncontrado());
  const eid = encodeURIComponent(p.id);
  if (p.orden_id) return box.append(pageHead(`Presupuesto ${p.codigo}`),
    empty("Este presupuesto ya se convirtió en orden y no se puede editar.", h("a", { class: "btn primary", href: `#presupuesto/${eid}` }, "Ver presupuesto")));
  const idx = await cargarIndice();
  const sel = selectorCliente(idx, { cliente: p.cliente, vehiculo_id: p.vehiculo_id });
  const form = asyncForm({ class: "stack-lg", novalidate: true }, [
    sel.el,
    h("div", { class: "card stack" }, h("h2", {}, "Presupuesto"), ...camposPresupuesto(p),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", type: "submit" }, "Guardar cambios"),
        h("a", { class: "btn ghost", href: `#presupuesto/${eid}` }, "Cancelar"))),
  ], async (fd) => {
    must(await sb.from("presupuestos").update({ ...leerCampos(fd), vehiculo_id: sel.vehiculoId }).eq("id", p.id).select("id").single());
    toast(`Presupuesto ${p.codigo} actualizado`);
    location.hash = `#presupuesto/${eid}`;
  });
  box.append(pageHead(`Editar ${p.codigo}`, p.cliente.nombre), form);
}

// ---------- Detalle ----------
function datosDoc(p, extra) {
  const v = p.vehiculo;
  return {
    tipoDoc: "presupuesto", taller: state.taller, codigo: p.codigo, badge: badgePr(p.estado),
    cliente: { nombre: p.cliente.nombre, cedula_ruc: p.cliente.cedula_ruc, telefono: p.cliente.telefono },
    vehiculo: v, motivo: p.motivo, descripcion: p.descripcion, ocultarDescripcionVacia: true, observaciones: p.observaciones,
    fecha: p.created_at, valido_hasta: new Date(new Date(p.created_at).getTime() + p.validez_dias * 86400000).toISOString(),
    items: extra?.items || [], totales: extra?.totales, aplica_iva: extra?.iva?.aplica_iva ?? p.aplica_iva,
    iva_porcentaje: extra?.iva?.iva_porcentaje ?? p.iva_porcentaje,
    datos_pago: state.taller.datos_pago,   // presupuestos: solo Estándar
  };
}

export async function renderDetalle(box, id) {
  if (!tieneEstandar(state.taller)) return bloqueado(box);
  const p = await cargarPr(id);
  if (!p) return box.append(noEncontrado());
  const eid = encodeURIComponent(p.id);
  const convertido = !!p.orden_id;

  const docBox = h("div", {}, documento(datosDoc(p)));
  const envioBox = h("div", { class: "no-print" });
  const ed = itemsEditor({
    tabla: "presupuesto_items", fk: "presupuesto_id", id: p.id, padre: "presupuestos",
    vistaTotales: "presupuestos_totales", idTotales: "presupuesto_id", conCostos: false,
    onCambio: (d) => {
      docBox.replaceChildren(documento(datosDoc(p, d)));
      envioBox.replaceChildren(botonesEnvio({ taller: state.taller, tipoDoc: "presupuesto", codigo: p.codigo,
        token: p.token_publico, cliente: p.cliente, total: d.totales?.total, docEl: () => docBox.querySelector(".print-doc") }));
    },
  });
  if (!convertido) await ed.cargar();
  else envioBox.replaceChildren(botonesEnvio({ taller: state.taller, tipoDoc: "presupuesto", codigo: p.codigo,
    token: p.token_publico, cliente: p.cliente, total: null, docEl: () => docBox.querySelector(".print-doc") }));

  // Estado del presupuesto
  const estadoSel = h("select", { class: "input estado-sel", "aria-label": "Estado del presupuesto", value: p.estado, disabled: convertido },
    Object.entries(ESTADOS_PR).filter(([k]) => k !== "convertido" || convertido).map(([k, n]) => h("option", { value: k }, n)));
  estadoSel.addEventListener("change", async () => {
    try {
      must(await sb.from("presupuestos").update({ estado: estadoSel.value }).eq("id", p.id).select("id").single());
      p.estado = estadoSel.value;
      docBox.replaceChildren(documento(datosDoc(p)));
      if (!convertido) await ed.cargar();
      toast(`Estado: ${ESTADOS_PR[p.estado]}`);
    } catch (e) { toast(errMsg(e), "error"); estadoSel.value = p.estado; }
  });

  function convertir() {
    if (!p.vehiculo) {
      if (confirm("Para convertir en orden, el presupuesto necesita un vehículo. ¿Quieres asignarlo ahora?")) location.hash = `#editar-presupuesto/${eid}`;
      return;
    }
    const body = h("div", { class: "stack" },
      h("p", {}, `Se creará una orden abierta para ${formatPlaca(p.vehiculo.placa)} con la mano de obra, los repuestos y el IVA de ${p.codigo}.`),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Tipo de mantenimiento *"),
        h("div", { class: "segmented" },
          h("label", {}, h("input", { type: "radio", name: "tipo", value: "preventivo" }), "Preventivo"),
          h("label", {}, h("input", { type: "radio", name: "tipo", value: "correctivo" }), "Correctivo"))),
      field(ETQ.km, input({ name: "km", type: "number", min: 0, max: 3000000, inputmode: "numeric" })));
    openDialog("Convertir en orden", body, {
      submitLabel: "Crear orden",
      onSubmit: async (fd) => {
        if (!fd.get("tipo")) throw userError("Elige si es mantenimiento preventivo o correctivo.");
        const km = num(fd, "km");
        if (Number.isNaN(km) || km < 0 || km > 3000000) throw userError("El kilometraje debe ser un número entre 0 y 3.000.000.");
        const { data, error } = await sb.rpc("convertir_presupuesto",
          { p_presupuesto: p.id, p_tipo: fd.get("tipo"), p_kilometraje: km == null ? null : Math.round(km) });
        if (error) throw ["22023", "P0002"].includes(error.code) ? userError(error.message) : error;
        toast(`Orden creada desde ${p.codigo}`);
        location.hash = `#orden/${encodeURIComponent(data)}`;
      },
    });
  }

  box.append(
    pageHead(`Presupuesto ${p.codigo}`, `${p.cliente.nombre}${p.vehiculo ? ` · ${formatPlaca(p.vehiculo.placa)}` : ""}`),
    h("div", { class: "actions no-print" },
      h("button", { class: "btn primary", type: "button", onclick: () => window.print() }, "Imprimir"),
      !convertido && h("a", { class: "btn ghost", href: `#editar-presupuesto/${eid}` }, "Editar"),
      convertido
        ? h("a", { class: "btn primary", href: `#orden/${encodeURIComponent(p.orden_id)}` }, "Ver la orden")
        : h("button", { class: "btn primary", type: "button", onclick: convertir }, "Convertir en orden"),
      estadoSel),
    convertido
      ? h("p", { class: "msg ok no-print" }, "Este presupuesto ya se convirtió en orden. La mano de obra y los repuestos ahora se editan en la orden.")
      : h("div", { class: "no-print" }, ed.el),
    envioBox,
    docBox);
  if (convertido) {
    // Solo lectura: mostrar ítems y totales en el documento
    const [ri, rt] = await Promise.all([
      sb.from("presupuesto_items").select("tipo,descripcion,cantidad,precio_unitario,subtotal,created_at").eq("presupuesto_id", p.id).order("created_at"),
      sb.from("presupuestos_totales").select("*").eq("presupuesto_id", p.id).maybeSingle(),
    ]);
    const totales = must(rt);
    docBox.replaceChildren(documento(datosDoc(p, { items: must(ri), totales })));
    envioBox.replaceChildren(botonesEnvio({ taller: state.taller, tipoDoc: "presupuesto", codigo: p.codigo,
      token: p.token_publico, cliente: p.cliente, total: totales?.total, docEl: () => docBox.querySelector(".print-doc") }));
  }
}
