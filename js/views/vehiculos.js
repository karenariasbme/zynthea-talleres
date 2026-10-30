import { sb } from "../sb.js";
import { h, must, val, normPlaca, formatPlaca, toast, errMsg } from "../util.js";
import { pageHead, field, input, openDialog, userError, empty, loading, errorBox } from "../ui.js";

export async function render(box) {
  const list = h("div", { class: "list" });
  const search = input({ type: "search", placeholder: "Buscar por placa", "aria-label": "Buscar vehículo por placa",
    autocapitalize: "characters", class: "input" });

  async function cargar() {
    list.replaceChildren(loading());
    const placa = normPlaca(search.value).replace(/[^A-Z0-9]/g, "");
    let query = sb.from("vehiculos").select("id,placa,marca,modelo,anio,color,cliente_id,clientes(nombre)").order("placa").limit(200);
    if (placa) query = query.ilike("placa", `%${placa}%`);
    const { data, error } = await query;
    if (error) return list.replaceChildren(errorBox(errMsg(error)));
    list.replaceChildren(...(data.length
      ? data.map((v) => fila(v, cargar))
      : [empty(placa ? "No hay vehículos con esa placa." : "Aún no tienes vehículos registrados.")]));
  }

  let t;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(cargar, 300); });

  box.append(
    pageHead("Vehículos", "Placas registradas en tu taller",
      h("button", { class: "btn primary", type: "button", onclick: () => vehiculoDialog(null, cargar) }, "+ Nuevo vehículo")),
    h("div", { class: "toolbar" }, search),
    list);
  await cargar();
}

function fila(v, recargar) {
  return h("div", { class: "card item" },
    h("span", { class: "plate" }, formatPlaca(v.placa)),
    h("div", { class: "item-main" },
      h("b", {}, [v.marca, v.modelo, v.anio].filter(Boolean).join(" ")),
      h("div", { class: "muted" }, [v.color, v.clientes?.nombre].filter(Boolean).join(" · "))),
    h("div", { class: "item-actions" },
      h("a", { class: "btn small ghost", href: `#historial/${encodeURIComponent(v.placa)}` }, "Historial"),
      h("button", { class: "btn small ghost", type: "button", onclick: () => vehiculoDialog(v, recargar) }, "Editar")));
}

async function vehiculoDialog(v, onSaved) {
  let clientes;
  try {
    clientes = must(await sb.from("clientes").select("id,nombre,cedula_ruc").order("nombre").limit(1000));
  } catch (e) {
    return toast(errMsg(e), "error");
  }
  if (!clientes.length) {
    alert("Primero registra al cliente dueño del vehículo en la sección Clientes (o usa Nueva orden, que crea ambos).");
    location.hash = "#clientes";
    return;
  }
  const body = h("div", { class: "stack" },
    field("Placa *", input({ name: "placa", required: true, maxlength: 12, class: "input plate-input",
      autocapitalize: "characters", value: v ? formatPlaca(v.placa) : "" })),
    h("div", { class: "cols" },
      field("Marca *", input({ name: "marca", required: true, maxlength: 60, value: v?.marca ?? "" })),
      field("Modelo *", input({ name: "modelo", required: true, maxlength: 60, value: v?.modelo ?? "" }))),
    h("div", { class: "cols" },
      field("Año", input({ name: "anio", type: "number", min: 1950, max: 2100, inputmode: "numeric", value: v?.anio ?? "" })),
      field("Color", input({ name: "color", maxlength: 40, value: v?.color ?? "" }))),
    field("Cliente (dueño) *", h("select", { name: "cliente_id", class: "input", required: true, value: v?.cliente_id ?? "" },
      h("option", { value: "" }, "Elige un cliente…"),
      clientes.map((c) => h("option", { value: c.id }, c.cedula_ruc ? `${c.nombre} · ${c.cedula_ruc}` : c.nombre)))));

  openDialog(v ? "Editar vehículo" : "Nuevo vehículo", body, {
    onSubmit: async (fd) => {
      const anio = val(fd, "anio");
      const datos = {
        placa: normPlaca(fd.get("placa")),
        marca: val(fd, "marca"),
        modelo: val(fd, "modelo"),
        anio: anio ? Number(anio) : null,
        color: val(fd, "color"),
        cliente_id: fd.get("cliente_id"),
      };
      if (!datos.placa) throw userError("Escribe la placa.");
      if (!datos.marca || !datos.modelo) throw userError("Escribe la marca y el modelo.");
      if (!datos.cliente_id) throw userError("Elige el cliente dueño del vehículo.");
      if (v) must(await sb.from("vehiculos").update(datos).eq("id", v.id).select("id").single());
      else must(await sb.from("vehiculos").insert(datos).select("id").single());
      toast(v ? "Vehículo actualizado" : "Vehículo creado");
      onSaved?.();
    },
  });
}
