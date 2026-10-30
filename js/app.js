import { sb } from "./sb.js";
import { h, errMsg, WHATSAPP, PLANES_URL, diasRestantes } from "./util.js";
import { state } from "./state.js";
import { loading, errorBox, tallerLogo } from "./ui.js";
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
};
// Pantallas internas que resaltan una sección del menú
const navOf = { orden: "inicio", cerrar: "inicio" };

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

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return location.replace("index.html");

  sb.auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_OUT" || !s) location.replace("index.html");
  });
  $("logoutBtn").addEventListener("click", logout);
  $("lockedLogout").addEventListener("click", logout);

  const { data: t, error } = await sb.from("talleres")
    .select("id,nombre,plan,trial_ends_at,ruc,direccion,telefono,correo,logo_path").maybeSingle();
  $("splash").replaceChildren();
  if (error || !t) {
    $("splash").append(
      h("p", {}, error ? errMsg(error) : "No encontramos el taller de tu cuenta. Escríbenos por WhatsApp y lo revisamos."),
      h("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Reintentar"),
      h("button", { class: "link light", type: "button", onclick: logout }, "Cerrar sesión"));
    return;
  }
  state.taller = t;
  $("splash").hidden = true;

  const vencida = t.plan === "demo" && t.trial_ends_at && new Date(t.trial_ends_at) <= new Date();
  if (vencida) return showLocked(t);

  updateChrome();
  $("shell").hidden = false;
  window.addEventListener("hashchange", route);
  route();
}

init().catch((e) => {
  $("splash").replaceChildren(h("p", {}, errMsg(e)),
    h("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Reintentar"));
});
