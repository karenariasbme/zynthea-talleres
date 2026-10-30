import { sb } from "./sb.js";
import { must, formatPlaca } from "./util.js";

/** Minúsculas y sin tildes, para comparar "Hyundai" = "hyundái", "María" = "maria". */
export const sinTildes = (s) => (s ?? "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Carga los clientes y vehículos del taller para buscar en el navegador.
 * El filtro ilike de la base distingue tildes; aquí la búsqueda es parcial y no distingue mayúsculas ni tildes.
 */
export async function cargarIndice() {
  const [rc, rv] = await Promise.all([
    sb.from("clientes").select("id,nombre,cedula_ruc,telefono,correo").order("nombre").limit(5000),
    sb.from("vehiculos").select("id,placa,marca,modelo,anio,color,cliente_id").order("placa").limit(5000),
  ]);
  const clientes = must(rc).map((c) => ({ ...c, vehiculos: [] }));
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const vehiculos = must(rv).map((v) => {
    const cliente = porId.get(v.cliente_id) || null;
    const item = { ...v, cliente };
    cliente?.vehiculos.push(item);
    return item;
  });
  for (const c of clientes) c._txt = sinTildes([c.nombre, c.cedula_ruc, c.telefono, c.correo].join(" "));
  for (const v of vehiculos)
    v._txt = sinTildes([v.placa, formatPlaca(v.placa), v.marca, v.modelo, v.anio, v.color, v.cliente?.nombre, v.cliente?.cedula_ruc].join(" "));
  return { clientes, vehiculos };
}

/**
 * Busca por placa, nombre o cédula del cliente, marca, modelo, año o color.
 * Cada palabra escrita debe aparecer (en cualquier orden): "kia gris" encuentra un Kia de color gris.
 */
export function buscarEnIndice(idx, texto, max = 20) {
  const palabras = sinTildes(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return { vehiculos: [], clientes: [] };
  const coincide = (txt) => palabras.every((p) => txt.includes(p) || txt.includes(p.replace(/-/g, "")));
  return {
    vehiculos: idx.vehiculos.filter((v) => coincide(v._txt)).slice(0, max),
    clientes: idx.clientes.filter((c) => coincide(c._txt)).slice(0, max),
  };
}
