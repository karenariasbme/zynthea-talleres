import { sb } from "../sb.js";
import { h, must, val, toast, errMsg } from "../util.js";
import { pageHead, field, input, openDialog, userError, empty, loading, errorBox } from "../ui.js";

/** Quita los caracteres con significado especial en los filtros de PostgREST. */
export const limpiarBusqueda = (q) => q.replace(/[,()*%\\:"']/g, " ").trim();

export async function render(box) {
  const list = h("div", { class: "list" });
  const search = input({ type: "search", placeholder: "Buscar por nombre o cédula/RUC", "aria-label": "Buscar cliente" });

  async function cargar() {
    list.replaceChildren(loading());
    const q = limpiarBusqueda(search.value);
    let query = sb.from("clientes").select("id,nombre,cedula_ruc,telefono,correo").order("nombre").limit(200);
    if (q) query = query.or(`nombre.ilike."*${q}*",cedula_ruc.ilike."*${q}*"`);
    const { data, error } = await query;
    if (error) return list.replaceChildren(errorBox(errMsg(error)));
    list.replaceChildren(...(data.length
      ? data.map((c) => fila(c, cargar))
      : [empty(q ? "No hay clientes que coincidan con la búsqueda." : "Aún no tienes clientes. Crea el primero.")]));
  }

  let t;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(cargar, 300); });

  box.append(
    pageHead("Clientes", "Dueños de los vehículos que atiende tu taller",
      h("button", { class: "btn primary", type: "button", onclick: () => clienteDialog(null, cargar) }, "+ Nuevo cliente")),
    h("div", { class: "toolbar" }, search),
    list);
  await cargar();
}

function fila(c, recargar) {
  return h("div", { class: "card item" },
    h("div", { class: "item-main" },
      h("b", {}, c.nombre),
      h("div", { class: "muted" }, [c.cedula_ruc, c.telefono, c.correo].filter(Boolean).join(" · ") || "Sin datos de contacto")),
    h("div", { class: "item-actions" },
      h("button", { class: "btn small ghost", type: "button", onclick: () => clienteDialog(c, recargar) }, "Editar"),
      h("button", { class: "btn small danger", type: "button", onclick: () => eliminar(c, recargar) }, "Eliminar")));
}

export function clienteDialog(c, onSaved) {
  const body = h("div", { class: "stack" },
    field("Nombre *", input({ name: "nombre", required: true, maxlength: 120, value: c?.nombre ?? "" })),
    field("Cédula / RUC", input({ name: "cedula_ruc", inputmode: "numeric", maxlength: 13, value: c?.cedula_ruc ?? "" })),
    field("Teléfono", input({ name: "telefono", type: "tel", maxlength: 20, value: c?.telefono ?? "" })),
    field("Correo", input({ name: "correo", type: "email", maxlength: 120, value: c?.correo ?? "" })));
  openDialog(c ? "Editar cliente" : "Nuevo cliente", body, {
    onSubmit: async (fd) => {
      const datos = { nombre: val(fd, "nombre"), cedula_ruc: val(fd, "cedula_ruc"), telefono: val(fd, "telefono"), correo: val(fd, "correo") };
      if (!datos.nombre) throw userError("Escribe el nombre del cliente.");
      if (c) must(await sb.from("clientes").update(datos).eq("id", c.id).select("id").single());
      else must(await sb.from("clientes").insert(datos).select("id").single());
      toast(c ? "Cliente actualizado" : "Cliente creado");
      onSaved?.();
    },
  });
}

async function eliminar(c, recargar) {
  try {
    const { count, error } = await sb.from("vehiculos").select("id", { count: "exact", head: true }).eq("cliente_id", c.id);
    if (error) throw error;
    if (count > 0) {
      alert(`No se puede eliminar a ${c.nombre}: tiene ${count} ${count === 1 ? "vehículo registrado" : "vehículos registrados"}. ` +
        "Primero asigna esos vehículos a otro cliente desde la sección Vehículos.");
      return;
    }
    if (!confirm(`¿Eliminar al cliente ${c.nombre}? Esta acción no se puede deshacer.`)) return;
    must(await sb.from("clientes").delete().eq("id", c.id).select("id").single());
    toast("Cliente eliminado");
    recargar();
  } catch (e) {
    toast(errMsg(e), "error");
  }
}
