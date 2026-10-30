import { sb } from "./sb.js";
import { h, errMsg, must, val, WHATSAPP, PLANES_URL, diasRestantes } from "./util.js";
import { state } from "./state.js";
import { loading, errorBox, tallerLogo, asyncForm, field, input, userError } from "./ui.js";
import * as inicio from "./views/inicio.js";
import * as nueva from "./views/nueva.js";
import * as orden from "./views/orden.js";
import * as clientes from "./views/clientes.js";
import * as vehiculos from "./views/vehiculos.js";
import * as historial from "./views/historial.js";
import * as taller from "./views/taller.js";

const $ = (id) => document.getElementById(id);

const routes = {
  inicio: inicio.render,
  nueva: nueva.render,
  clientes: clientes.render,
  vehiculos: vehiculos.render,
  historial: historial.render,
  taller: taller.render,
  orden: orden.renderDetalle,
  cerrar: orden.renderCerrar,
  editar: orden.renderEditar,
};
// Pantallas internas que resaltan una sección del menú
const navOf = { orden: "inicio", cerrar: "inicio", editar: "inicio" };

let seq = 0;
async function route() {
  const [name, ...rest] = location.hash.replace(/^#/, "").split("/");
  const key = routes[name] ? name : "inicio";
  const arg = decodeURIComponent(rest.join("/"));
  for (const a of document.querySelectorAll("#nav a")) {
    if (a.dataset.route === (navOf[key] || key)) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const view = $("view");
  const token = ++seq;
  view.replaceChildren(loading());
  const box = h("div", { class: "page" });
  try {
    await routes[key](box, arg);
    if (token === seq) view.replaceChildren(box);
  } catch (e) {
    if (token === seq) view.replaceChildren(errorBox(errMsg(e)));
  }
  if (token === seq) window.scrollTo(0, 0);
}
state.refresh = route;

async function logout() {
  await sb.auth.signOut();
  location.replace("index.html");
}

/** Logo, nombre del taller y aviso de demo en la barra superior y el menú. */
function updateChrome() {
  const t = state.taller;
  $("tallerLogo").replaceChildren(tallerLogo(t, "sm"));
  $("tallerName").textContent = t.nombre;
  document.title = `${t.nombre} · Sistema para Talleres`;

  const banner = $("trialBanner");
  const demo = t.plan === "demo";
  banner.hidden = !demo;
  $("activarBtn").hidden = !demo;
  if (!demo) return;
  const days = diasRestantes(t);
  banner.classList.toggle("warn", days <= 2);
  banner.replaceChildren(
    h("span", {}, `Demo: te quedan ${days} ${days === 1 ? "día" : "días"}`),
    h("a", { href: PLANES_URL }, "Activar plan →"));
}
state.updateChrome = updateChrome;

function showLocked(t) {
  $("shell").hidden = true;
  $("locked").hidden = false;
  $("lockedLogo").replaceChildren(tallerLogo(t, "lg"));
  $("lockedTaller").textContent = t.nombre;
  const text = `Hola Karen, mi demo del Sistema para Talleres terminó y quiero activar mi plan para el taller "${t.nombre}".`;
  $("lockedWa").href = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
}

/** Código de error que devuelve Google/Supabase en la URL al cancelar o fallar el inicio de sesión. */
function errorOAuth(url) {
  const u = new URL(url);
  return new URLSearchParams(u.hash.slice(1)).get("error") || u.searchParams.get("error");
}

/** ¿El error indica que la sesión ya no es válida (usuario borrado, token inválido)? Un fallo de red no cuenta. */
const sesionInvalida = (e) =>
  [401, 403].includes(e?.status) || /user_not_found|bad_jwt|session_not_found|invalid.*(jwt|token)|user.*not.*exist/i.test(`${e?.code} ${e?.message}`);

/** Cierra la sesión local y vuelve al login con el aviso de sesión expirada. */
async function expulsar() {
  try { await sb.auth.signOut({ scope: "local" }); } catch { /* la sesión ya no existe en el servidor */ }
  location.replace("index.html?sesion=expirada");
}

/** Cuentas nuevas con Google: el taller se crea como "Mi taller". Pide el nombre antes de usar la app. */
function bienvenida(t) {
  return new Promise((resolve) => {
    const form = asyncForm({ class: "stack" }, [
      field("Nombre del taller *", input({ name: "nombre", required: true, maxlength: 120, autocomplete: "organization",
        placeholder: "Ej.: Mecánica Automotriz Los Andes" })),
      field("Teléfono", input({ name: "telefono", type: "tel", maxlength: 20 })),
      field("Dirección", input({ name: "direccion", maxlength: 200 })),
      h("p", { class: "note" }, "Puedes subir tu logo luego en Mi taller."),
      h("button", { class: "btn primary block", type: "submit" }, "Empezar"),
    ], async (fd) => {
      const nombre = val(fd, "nombre");
      if (!nombre || nombre.toLowerCase() === "mi taller") throw userError("Escribe el nombre de tu taller.");
      const nuevo = must(await sb.from("talleres")
        .update({ nombre, telefono: val(fd, "telefono"), direccion: val(fd, "direccion") })
        .eq("id", t.id).select(TALLER_COLS).single());
      $("welcome").hidden = true;
      resolve(nuevo);
    });
    $("welcome").replaceChildren(
      h("div", { class: "card locked-card welcome-card" },
        h("h1", {}, "¡Bienvenido!"),
        h("p", {}, "¿Cómo se llama tu taller? Aparecerá en la app y en tus órdenes de trabajo."),
        form,
        h("button", { class: "link", type: "button", onclick: logout }, "Cerrar sesión"),
        h("p", { class: "foot-credit" }, "Desarrollado por Zynthea Solutions")));
    $("welcome").hidden = false;
    $("welcome").querySelector("input").focus();
  });
}

const TALLER_COLS = "id,nombre,plan,trial_ends_at,ruc,direccion,telefono,correo,logo_path";

async function init() {
  const errGoogle = errorOAuth(window.__urlInicial || location.href);
  if (errGoogle) return location.replace(`index.html?oauth_error=${encodeURIComponent(errGoogle)}`);

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return location.replace("index.html");

  // La sesión guardada puede ser de un usuario que ya no existe: validarla con el servidor
  const { data: ud, error: ue } = await sb.auth.getUser();
  if (ue || !ud?.user) {
    if (!ue || sesionInvalida(ue)) return expulsar();
    throw ue; // fallo de red: se muestra el error con "Reintentar"
  }

  const { data: t, error } = await sb.from("talleres").select(TALLER_COLS).maybeSingle();
  if (error) {
    if (sesionInvalida(error)) return expulsar();
    throw error;
  }
  if (!t) return expulsar(); // usuario sin taller

  sb.auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_OUT" || !s) location.replace("index.html");
  });
  $("logoutBtn").addEventListener("click", logout);
  $("lockedLogout").addEventListener("click", logout);
  $("splash").hidden = true;

  const vencida = t.plan === "demo" && t.trial_ends_at && new Date(t.trial_ends_at) <= new Date();
  if (vencida) return showLocked(t);

  state.taller = t.nombre.trim().toLowerCase() === "mi taller" ? await bienvenida(t) : t;

  updateChrome();
  $("shell").hidden = false;
  window.addEventListener("hashchange", route);
  // Tocar la sección en la que ya estás la vuelve a cargar (p. ej. "Nueva orden" después de crear una)
  for (const a of document.querySelectorAll("#nav a")) {
    a.addEventListener("click", (e) => {
      if (a.getAttribute("href") === location.hash) { e.preventDefault(); route(); }
    });
  }
  route();
}

init().catch((e) => {
  $("splash").replaceChildren(h("p", {}, errMsg(e)),
    h("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Reintentar"));
});
