// Página de enlaces del taller (enlaces.html?t=<slug>). Sin sesión.
// Solo usa taller_publico, horarios_disponibles y reservar_turno (SECURITY DEFINER en la base):
// nunca lee reservas ajenas. El diseño está en enlaces-vista.js.
import { sb } from "../sb.js";
import { h, hoyLocal } from "../util.js";
import { logoUrl } from "../ui.js";
import { pintarPagina, pintarAviso } from "./enlaces-vista.js";

const slug = (new URLSearchParams(location.search).get("t") || "").toLowerCase();
const raiz = document.getElementById("pagina");

const noDisponible = () => {
  document.title = "Página no disponible";
  pintarAviso(raiz, "Página no disponible", "Este enlace no existe o el taller no lo tiene activo.");
};

async function cargar() {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return noDisponible();
  const { data: t, error } = await sb.rpc("taller_publico", { p_slug: slug });
  if (error) {
    return pintarAviso(raiz, "No se pudo cargar", "Revisa tu conexión e inténtalo de nuevo.",
      h("button", { class: "lk-boton", type: "button", onclick: () => location.reload() }, "Reintentar"));
  }
  if (!t) return noDisponible();
  pintarPagina(raiz, t, {
    logoUrl: logoUrl(t.logo_path),
    hoy: hoyLocal(),
    maxFecha: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    cargarHoras: (fecha) => sb.rpc("horarios_disponibles", { p_slug: slug, p_fecha: fecha }),
    reservar: (datos) => sb.rpc("reservar_turno", { p_slug: slug, ...datos }),
  });
}

cargar();
