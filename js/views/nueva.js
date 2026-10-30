import { sb } from "../sb.js";
import { h, must, val, normPlaca, formatPlaca, toLocalInput, fromLocalInput } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, textarea, asyncForm, userError } from "../ui.js";

const VEH_COLS = "id,placa,marca,modelo,anio,color,cliente_id,clientes(nombre,telefono,cedula_ruc)";

export async function render(box) {
  const step2 = h("div", { class: "stack-lg" });

  const placaIn = input({ name: "placa", placeholder: "ABC-1234", autocomplete: "off",
    autocapitalize: "characters", required: true, class: "input plate-input", maxlength: 12 });
  const buscar = asyncForm({ class: "card stack" }, [
    h("h2", {}, "1. Busca el vehículo por placa"),
    h("div", { class: "row" }, placaIn, h("button", { class: "btn primary", type: "submit" }, "Buscar")),
  ], async (fd) => {
    const placa = normPlaca(fd.get("placa"));
    if (!placa) throw userError("Escribe la placa del vehículo.");
    const veh = must(await sb.from("vehiculos").select(VEH_COLS).eq("placa", placa).maybeSingle());
    step2.replaceChildren();
    if (veh) await showExisting(step2, veh);
    else await showNew(step2, placa);
    step2.scrollIntoView({ block: "start", behavior: "smooth" });
  });

  box.append(pageHead("Nueva orden", "Registra el ingreso de un vehículo al taller"), buscar, step2);
  placaIn.focus();
}

/** El vehículo ya existe: mostrarlo y pedir solo los datos de la orden. */
async function showExisting(box, veh) {
  const abierta = must(await sb.from("ordenes_trabajo").select("id,codigo")
    .eq("vehiculo_id", veh.id).is("fecha_salida", null).limit(1).maybeSingle());

  box.append(
    h("div", { class: "card stack" },
      h("h2", {}, "2. Vehículo encontrado"),
      vehiculoResumen(veh),
      abierta && h("p", { class: "msg warn" }, "Este vehículo ya tiene una orden abierta: ",
        h("a", { href: `#orden/${encodeURIComponent(abierta.id)}` }, abierta.codigo), ". Puedes crear otra de todas formas.")),
    ordenForm(async () => veh.id, "3. Datos de la orden"));
}

/** Placa nueva: crear cliente (o elegir uno existente) + vehículo + orden en un solo formulario. */
async function showNew(box, placa) {
  const lista = must(await sb.from("clientes").select("id,nombre,cedula_ruc").order("nombre").limit(1000));

  const nuevoFields = h("div", { class: "stack" },
    field("Nombre del cliente *", input({ name: "c_nombre", maxlength: 120 })),
    h("div", { class: "cols" },
      field("Cédula / RUC", input({ name: "c_cedula", inputmode: "numeric", maxlength: 13 })),
      field("Teléfono", input({ name: "c_telefono", type: "tel", maxlength: 20 }))),
    field("Correo", input({ name: "c_correo", type: "email", maxlength: 120 })));

  const select = h("select", { name: "c_id", class: "input" },
    h("option", { value: "" }, "Elige un cliente…"),
    lista.map((c) => h("option", { value: c.id }, c.cedula_ruc ? `${c.nombre} · ${c.cedula_ruc}` : c.nombre)));
  const existenteFields = h("div", { class: "stack", hidden: true },
    lista.length ? field("Cliente", select) : h("p", { class: "note" }, "Aún no tienes clientes registrados."));

  const modo = (m) => { nuevoFields.hidden = m !== "nuevo"; existenteFields.hidden = m !== "existente"; };
  const radios = h("div", { class: "segmented" },
    h("label", {}, h("input", { type: "radio", name: "c_modo", value: "nuevo", checked: true, onchange: () => modo("nuevo") }), "Cliente nuevo"),
    h("label", {}, h("input", { type: "radio", name: "c_modo", value: "existente", onchange: () => modo("existente") }), "Cliente existente"));

  const vehFields = h("div", { class: "stack" },
    field("Placa *", input({ name: "v_placa", value: formatPlaca(placa), required: true, class: "input plate-input", maxlength: 12 })),
    h("div", { class: "cols" },
      field("Marca *", input({ name: "v_marca", required: true, maxlength: 60 })),
      field("Modelo *", input({ name: "v_modelo", required: true, maxlength: 60 }))),
    h("div", { class: "cols" },
      field("Año", input({ name: "v_anio", type: "number", min: 1950, max: 2100, inputmode: "numeric" })),
      field("Color", input({ name: "v_color", maxlength: 40 }))));

  // Si el cliente o el vehículo ya se crearon y falla un paso posterior, no se vuelven a crear al reintentar
  let vehiculoId = null;

  const crearVehiculo = async (fd) => {
    if (vehiculoId) return vehiculoId;
    let clienteId;
    let clienteNuevo = null;
    if (fd.get("c_modo") === "existente") {
      clienteId = fd.get("c_id");
      if (!clienteId) throw userError("Elige el cliente dueño del vehículo.");
    } else {
      const nombre = val(fd, "c_nombre");
      if (!nombre) throw userError("Escribe el nombre del cliente.");
      clienteNuevo = must(await sb.from("clientes").insert({
        nombre, cedula_ruc: val(fd, "c_cedula"), telefono: val(fd, "c_telefono"), correo: val(fd, "c_correo"),
      }).select("id").single());
      clienteId = clienteNuevo.id;
    }
    const anio = val(fd, "v_anio");
    const { data, error } = await sb.from("vehiculos").insert({
      cliente_id: clienteId,
      placa: normPlaca(fd.get("v_placa")),
      marca: val(fd, "v_marca"),
      modelo: val(fd, "v_modelo"),
      anio: anio ? Number(anio) : null,
      color: val(fd, "v_color"),
    }).select("id").single();
    if (error) {
      // no dejar un cliente huérfano si el vehículo no se pudo crear
      if (clienteNuevo) await sb.from("clientes").delete().eq("id", clienteNuevo.id);
      throw error;
    }
    vehiculoId = data.id;
    return vehiculoId;
  };

  box.append(ordenForm(crearVehiculo, "3. Datos de la orden", [
    h("div", { class: "card stack" },
      h("h2", {}, "2. Placa nueva: registra cliente y vehículo"),
      h("p", { class: "note" }, `No encontramos la placa ${formatPlaca(placa)}. Completa estos datos y la orden en un solo paso.`),
      h("h3", {}, "Cliente"), radios, nuevoFields, existenteFields,
      h("h3", {}, "Vehículo"), vehFields),
  ]));
}

/** Formulario de la orden. getVehiculoId crea lo necesario y devuelve el id del vehículo. */
function ordenForm(getVehiculoId, title, before = []) {
  const now = toLocalInput();
  const form = asyncForm({ class: "stack-lg" }, [
    before,
    h("div", { class: "card stack" },
      h("h2", {}, title),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Tipo de mantenimiento *"),
        h("div", { class: "segmented" },
          h("label", {}, h("input", { type: "radio", name: "tipo", value: "preventivo", required: true }), "Preventivo"),
          h("label", {}, h("input", { type: "radio", name: "tipo", value: "correctivo" }), "Correctivo"))),
      field("Motivo *", input({ name: "motivo", required: true, maxlength: 200, placeholder: "Ej.: cambio de aceite, ruido en frenos" })),
      field("Descripción del trabajo", textarea({ name: "descripcion", maxlength: 2000 })),
      field("Fecha y hora de ingreso *", input({ name: "fecha_ingreso", type: "datetime-local", required: true, value: now, max: "2100-12-31T23:59" })),
      field("¿Cómo llegó el vehículo?", textarea({ name: "observacion_ingreso", maxlength: 2000,
        placeholder: "Ej.: rayón en puerta derecha, tanque a 1/4, sin tapacubos" })),
      h("button", { class: "btn primary block", type: "submit" }, "Guardar orden")),
  ], async (fd, formEl) => {
    if (!fd.get("tipo")) throw userError("Elige si es mantenimiento preventivo o correctivo.");
    const motivo = val(fd, "motivo");
    if (!motivo) throw userError("Escribe el motivo de ingreso.");
    if (!fd.get("fecha_ingreso")) throw userError("Indica la fecha y hora de ingreso.");
    const vehiculo_id = await getVehiculoId(fd);
    const o = must(await sb.from("ordenes_trabajo").insert({
      vehiculo_id,
      tipo: fd.get("tipo"),
      motivo,
      descripcion: val(fd, "descripcion"),
      fecha_ingreso: fromLocalInput(fd.get("fecha_ingreso")),
      observacion_ingreso: val(fd, "observacion_ingreso"),
    }).select("id,codigo").single());
    showCreated(formEl.closest(".page"), o);
  });
  return form;
}

function showCreated(page, o) {
  const id = encodeURIComponent(o.id);
  page.replaceChildren(
    h("div", { class: "card success stack" },
      h("p", { class: "eyebrow" }, "Orden creada"),
      h("p", { class: "big-code" }, o.codigo),
      h("p", {}, "La orden quedó abierta. Ciérrala cuando entregues el vehículo."),
      h("div", { class: "actions" },
        h("a", { class: "btn primary", href: `#orden/${id}` }, "Ver / imprimir orden"),
        h("button", { class: "btn ghost", type: "button", onclick: () => state.refresh() }, "Crear otra orden"),
        h("a", { class: "btn ghost", href: "#inicio" }, "Ir al inicio"))));
  window.scrollTo(0, 0);
}

export function vehiculoResumen(v) {
  const c = v.clientes || {};
  return h("div", { class: "veh-summary" },
    h("span", { class: "plate big" }, formatPlaca(v.placa)),
    h("div", {},
      h("b", {}, [v.marca, v.modelo, v.anio].filter(Boolean).join(" ")),
      v.color && h("div", { class: "muted" }, `Color: ${v.color}`),
      h("div", { class: "muted" }, "Cliente: ", c.nombre || "—", c.telefono ? ` · ${c.telefono}` : "")));
}
