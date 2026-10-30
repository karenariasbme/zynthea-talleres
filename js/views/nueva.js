import { sb } from "../sb.js";
import { h, must, val, normPlaca, formatPlaca, toLocalInput, fromLocalInput } from "../util.js";
import { state } from "../state.js";
import { pageHead, field, input, textarea, asyncForm, userError } from "../ui.js";
import { cargarIndice, buscarEnIndice } from "../buscar.js";

const CLI_COLS = "id,nombre,cedula_ruc,telefono,correo";
const VEH_COLS = "id,placa,marca,modelo,anio,color,cliente_id";

const detalleVehiculo = (v) => [v.marca, v.modelo, v.anio, v.color].filter(Boolean).join(" · ");

/**
 * Formulario completo en 3 bloques (Cliente, Vehículo, Orden). El buscador de arriba es opcional:
 * al elegir un cliente o vehículo ya registrado, sus bloques se autocompletan y se bloquean.
 */
export async function render(box) {
  const idx = await cargarIndice();
  let cliente = null;   // cliente existente elegido (bloque bloqueado)
  let vehiculo = null;  // vehículo existente elegido (bloque bloqueado)

  // ---------- Bloque Cliente ----------
  const cNombre = input({ name: "c_nombre", maxlength: 120, autocomplete: "off" });
  const cCampos = h("div", { class: "stack" },
    field("Nombre o razón social *", cNombre),
    h("div", { class: "cols" },
      field("Cédula / RUC", input({ name: "c_cedula", inputmode: "numeric", maxlength: 13 })),
      field("Teléfono", input({ name: "c_telefono", type: "tel", maxlength: 20 }))),
    field("Correo", input({ name: "c_correo", type: "email", maxlength: 120 })));
  const cFijo = h("div", { class: "locked-block" });
  const cBloque = h("div", { class: "card stack" }, h("h2", {}, "1. Cliente"), cFijo, cCampos);

  // ---------- Bloque Vehículo ----------
  const vPlaca = input({ name: "v_placa", maxlength: 12, class: "input plate-input", autocapitalize: "characters", autocomplete: "off", placeholder: "ABC-1234" });
  const avisoPlaca = h("div");
  const delCliente = h("div");
  const vCampos = h("div", { class: "stack" },
    delCliente,
    field("Placa *", vPlaca), avisoPlaca,
    h("div", { class: "cols" },
      field("Marca *", input({ name: "v_marca", maxlength: 60 })),
      field("Modelo *", input({ name: "v_modelo", maxlength: 60 }))),
    h("div", { class: "cols" },
      field("Año", input({ name: "v_anio", type: "number", min: 1950, max: 2100, inputmode: "numeric" })),
      field("Color", input({ name: "v_color", maxlength: 40 }))));
  const vFijo = h("div", { class: "locked-block" });
  const avisoAbierta = h("div");
  const vBloque = h("div", { class: "card stack" }, h("h2", {}, "2. Vehículo"), vFijo, vCampos, avisoAbierta);

  function pintar() {
    cFijo.hidden = !cliente;
    cCampos.hidden = !!cliente;
    if (cliente) {
      cFijo.replaceChildren(
        h("div", { class: "locked-info" },
          h("b", {}, cliente.nombre),
          h("span", { class: "muted" }, [cliente.cedula_ruc, cliente.telefono, cliente.correo].filter(Boolean).join(" · ") || "Sin datos de contacto")),
        h("button", { class: "btn small ghost", type: "button", onclick: () => { cliente = null; vehiculo = null; pintar(); cNombre.focus(); } }, "Cambiar"));
    }

    vFijo.hidden = !vehiculo;
    vCampos.hidden = !!vehiculo;
    if (vehiculo) {
      vFijo.replaceChildren(
        h("div", { class: "locked-info" },
          h("span", { class: "plate big" }, formatPlaca(vehiculo.placa)),
          h("b", {}, detalleVehiculo(vehiculo))),
        h("button", { class: "btn small ghost", type: "button", onclick: () => { vehiculo = null; pintar(); vPlaca.focus(); } }, "Cambiar"));
    }

    // Cliente existente sin vehículo elegido: ofrecer sus vehículos o registrar uno nuevo
    const propios = cliente && !vehiculo ? idx.vehiculos.filter((v) => v.cliente_id === cliente.id) : [];
    delCliente.replaceChildren(...(cliente && !vehiculo ? [
      h("p", { class: "note" }, propios.length
        ? `${cliente.nombre} tiene ${propios.length} ${propios.length === 1 ? "vehículo" : "vehículos"}. Elige uno o registra uno nuevo abajo:`
        : `Registra el vehículo de ${cliente.nombre}:`),
      propios.length && h("div", { class: "chips" }, propios.map((v) =>
        h("button", { class: "chip", type: "button", onclick: () => elegirVehiculo(v) },
          h("span", { class: "plate" }, formatPlaca(v.placa)), " ", `${v.marca} ${v.modelo}`))),
    ] : []));

    revisarPlaca();
    revisarAbierta();
  }

  function elegirVehiculo(v) {
    vehiculo = v;
    cliente = v.cliente;
    avisoPlaca.replaceChildren();
    pintar();
  }
  function elegirCliente(c) {
    cliente = c;
    vehiculo = null;
    pintar();
  }

  /** Avisa si la placa escrita ya existe y ofrece usar ese vehículo. */
  function revisarPlaca() {
    const p = normPlaca(vPlaca.value);
    const existente = !vehiculo && p ? idx.vehiculos.find((v) => v.placa === p) : null;
    avisoPlaca.replaceChildren(...(existente ? [avisoExistente(existente)] : []));
    return existente;
  }
  const avisoExistente = (v) =>
    h("div", { class: "msg warn stack-sm" },
      h("span", {}, `La placa ${formatPlaca(v.placa)} ya está registrada: ${detalleVehiculo(v)}, de ${v.cliente?.nombre || "otro cliente"}.`),
      h("button", { class: "btn small primary", type: "button", onclick: () => elegirVehiculo(v) }, "Usar ese vehículo"));
  vPlaca.addEventListener("input", revisarPlaca);

  let abiertaSeq = 0;
  async function revisarAbierta() {
    const token = ++abiertaSeq;
    avisoAbierta.replaceChildren();
    if (!vehiculo) return;
    const { data } = await sb.from("ordenes_trabajo").select("id,codigo").eq("vehiculo_id", vehiculo.id).is("fecha_salida", null).limit(1).maybeSingle();
    if (data && token === abiertaSeq) {
      avisoAbierta.replaceChildren(h("p", { class: "msg warn" }, "Este vehículo ya tiene una orden abierta: ",
        h("a", { href: `#orden/${encodeURIComponent(data.id)}` }, data.codigo), ". Puedes crear otra de todas formas."));
    }
  }

  // ---------- Buscador opcional ----------
  const q = input({ type: "search", placeholder: "Placa, cliente, cédula, marca, modelo o color", "aria-label": "Buscar cliente o vehículo registrado", autocomplete: "off" });
  const resultados = h("div", { class: "search-results" });
  function buscar() {
    const texto = q.value.trim();
    if (texto.length < 2) return resultados.replaceChildren();
    const r = buscarEnIndice(idx, texto, 8);
    if (!r.vehiculos.length && !r.clientes.length) return resultados.replaceChildren(h("p", { class: "note" }, "Sin coincidencias. Completa el formulario como cliente nuevo."));
    const elegir = (fn) => () => { fn(); q.value = ""; resultados.replaceChildren(); };
    resultados.replaceChildren(
      ...r.vehiculos.map((v) => h("button", { class: "result", type: "button", onclick: elegir(() => elegirVehiculo(v)) },
        h("span", { class: "plate" }, formatPlaca(v.placa)),
        h("span", { class: "result-main" }, h("b", {}, detalleVehiculo(v)), h("span", { class: "muted" }, v.cliente?.nombre || "")),
        h("span", { class: "result-go" }, "Usar"))),
      ...r.clientes.map((c) => h("button", { class: "result", type: "button", onclick: elegir(() => elegirCliente(c)) },
        h("span", { class: "result-main" }, h("b", {}, c.nombre),
          h("span", { class: "muted" }, [c.cedula_ruc, `${c.vehiculos.length} ${c.vehiculos.length === 1 ? "vehículo" : "vehículos"}`].filter(Boolean).join(" · "))),
        h("span", { class: "result-go" }, "Cliente"))));
  }
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(buscar, 200); });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });

  // ---------- Bloque Orden + guardar ----------
  const form = asyncForm({ class: "stack-lg", novalidate: true }, [
    cBloque,
    vBloque,
    h("div", { class: "card stack" },
      h("h2", {}, "3. Orden"),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Tipo de mantenimiento *"),
        h("div", { class: "segmented" },
          h("label", {}, h("input", { type: "radio", name: "tipo", value: "preventivo" }), "Preventivo"),
          h("label", {}, h("input", { type: "radio", name: "tipo", value: "correctivo" }), "Correctivo"))),
      field("Motivo *", input({ name: "motivo", maxlength: 200, placeholder: "Ej.: cambio de aceite, ruido en frenos" })),
      field("Descripción del trabajo", textarea({ name: "descripcion", maxlength: 2000 })),
      field("Fecha y hora de ingreso *", input({ name: "fecha_ingreso", type: "datetime-local", value: toLocalInput(), max: "2100-12-31T23:59" })),
      field("¿Cómo llegó el vehículo?", textarea({ name: "observacion_ingreso", maxlength: 2000, placeholder: "Ej.: rayón en puerta derecha, tanque a 1/4" })),
      field("Observaciones", textarea({ name: "observaciones", maxlength: 2000, placeholder: "Notas generales de la orden" })),
      h("button", { class: "btn primary block", type: "submit" }, "Guardar orden")),
  ], async (fd, formEl) => {
    // Validar todo antes de crear nada
    if (!fd.get("tipo")) throw userError("Elige si es mantenimiento preventivo o correctivo.");
    const motivo = val(fd, "motivo");
    if (!motivo) throw userError("Escribe el motivo de ingreso.");
    if (!fd.get("fecha_ingreso")) throw userError("Indica la fecha y hora de ingreso.");
    if (!cliente && !val(fd, "c_nombre")) throw userError("Escribe el nombre del cliente o elige uno registrado.");
    const placa = normPlaca(fd.get("v_placa"));
    if (!vehiculo) {
      if (!placa || !val(fd, "v_marca") || !val(fd, "v_modelo")) throw userError("Completa placa, marca y modelo del vehículo, o elige uno registrado.");
      const enBase = must(await sb.from("vehiculos").select(VEH_COLS).eq("placa", placa).maybeSingle());
      if (enBase) {
        const v = idx.vehiculos.find((x) => x.id === enBase.id) || { ...enBase, cliente: idx.clientes.find((c) => c.id === enBase.cliente_id) };
        avisoPlaca.replaceChildren(avisoExistente(v));
        throw userError(`La placa ${formatPlaca(placa)} ya está registrada. Usa el vehículo existente o corrige la placa.`);
      }
    }

    // Cliente nuevo → vehículo nuevo → orden. Lo creado queda bloqueado para no duplicarlo si un paso posterior falla.
    let clienteNuevo = false;
    if (!cliente) {
      cliente = { ...must(await sb.from("clientes").insert({
        nombre: val(fd, "c_nombre"), cedula_ruc: val(fd, "c_cedula"), telefono: val(fd, "c_telefono"), correo: val(fd, "c_correo"),
      }).select(CLI_COLS).single()), vehiculos: [] };
      clienteNuevo = true;
    }
    if (!vehiculo) {
      const anio = val(fd, "v_anio");
      const { data, error } = await sb.from("vehiculos").insert({
        cliente_id: cliente.id, placa, marca: val(fd, "v_marca"), modelo: val(fd, "v_modelo"),
        anio: anio ? Number(anio) : null, color: val(fd, "v_color"),
      }).select(VEH_COLS).single();
      if (error) {
        if (clienteNuevo) { await sb.from("clientes").delete().eq("id", cliente.id); cliente = null; }
        pintar();
        throw error;
      }
      vehiculo = { ...data, cliente };
    }
    pintar();

    const o = must(await sb.from("ordenes_trabajo").insert({
      vehiculo_id: vehiculo.id,
      tipo: fd.get("tipo"),
      motivo,
      descripcion: val(fd, "descripcion"),
      fecha_ingreso: fromLocalInput(fd.get("fecha_ingreso")),
      observacion_ingreso: val(fd, "observacion_ingreso"),
      observaciones: val(fd, "observaciones"),
    }).select("id,codigo").single());
    showCreated(formEl.closest(".page"), o);
  });

  pintar();
  box.append(
    pageHead("Nueva orden", "Registra el ingreso de un vehículo al taller"),
    h("div", { class: "card search-card" },
      h("label", { class: "field-label" }, "¿Cliente o vehículo ya registrado? (opcional)"),
      q, resultados),
    form);
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
