export const TZ = "America/Guayaquil";
export const PLANES_URL = "https://karenariasbme.github.io/KarenArias/talleres/#planes";
export const WHATSAPP = "593967857347";

/**
 * Crea un elemento del DOM. Los hijos de tipo texto se insertan como nodos de texto,
 * nunca como HTML, así que es seguro pasarle datos escritos por el usuario.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") value = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  // value al final: en un <select> las opciones deben existir antes de elegir una
  if (value !== undefined) el.value = value;
  return el;
}

/** Devuelve data o lanza el error de una respuesta de Supabase. */
export function must({ data, error }) {
  if (error) throw error;
  return data;
}

/** Texto de un campo de formulario sin espacios extremos; vacío → null. */
export function val(fd, name) {
  const v = (fd.get(name) ?? "").toString().trim();
  return v === "" ? null : v;
}

/** Quita los caracteres con significado especial en los filtros de PostgREST. */
export const limpiarBusqueda = (q) => (q || "").replace(/[,()*%\\:"']/g, " ").trim();

// ---------- Plan ----------
export const PLANES = { demo: "Demo gratuita", basico: "Básico", estandar: "Estándar", profesional: "Profesional", premium: "Premium" };

/** Días que le quedan a la demo (mínimo 1 mientras esté vigente). */
export function diasRestantes(taller) {
  const ms = new Date(taller.trial_ends_at) - Date.now();
  return Math.max(1, Math.ceil(ms / 86400000));
}

// ---------- Placas ----------
export const normPlaca = (p) => (p || "").toUpperCase().replace(/[\s-]/g, "");
/** ¿El texto tiene forma de placa (letras + números, sin espacios internos)? */
export const parecePlaca = (t) => /^[A-Za-z]{2,3}[\s-]?\d{3,4}$/.test((t || "").trim());

/** En la base se guardan sin guion (ABC1234); se muestran como ABC-1234. */
export function formatPlaca(p) {
  const n = normPlaca(p);
  const m = n.match(/^([A-Z]{2,3})(\d{3,4})$/);
  return m ? `${m[1]}-${m[2]}` : n;
}

// ---------- Fechas (America/Guayaquil) ----------
const fmtDT = new Intl.DateTimeFormat("es-EC", {
  timeZone: TZ, day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
export const fmtFecha = (iso) => (iso ? fmtDT.format(new Date(iso)) : "—");

/** Fecha → valor para <input type="datetime-local"> en hora de Ecuador. */
export function toLocalInput(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(date).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** Valor de datetime-local (hora de Ecuador) → ISO. Ecuador continental no usa horario de verano: UTC-5 fijo. */
export const fromLocalInput = (v) => new Date(`${v}:00-05:00`).toISOString();

// ---------- Errores en español ----------
export function errMsg(e) {
  if (!e) return "Ocurrió un error inesperado.";
  const m = e.message || String(e);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m))
    return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  switch (e.code) {
    case "23505":
      return /placa/i.test(m) ? "Ya existe un vehículo con esa placa en tu taller." : "Ese registro ya existe.";
    case "23503":
      return "No se puede completar: hay registros relacionados (vehículos u órdenes).";
    case "23514":
      if (/ordenes_trabajo_check|fecha/i.test(m)) return "La fecha de salida no puede ser anterior a la de ingreso.";
      if (/anio/i.test(m)) return "El año debe estar entre 1950 y 2100.";
      return "Algún dato no es válido.";
    case "23502":
      return "Falta completar un campo obligatorio.";
    case "42501":
      return "No tienes permiso para esta acción. Si tu demo terminó, activa tu plan.";
    case "PGRST116":
      return "No se encontró el registro.";
  }
  if (/JWT|session/i.test(m)) return "Tu sesión expiró. Vuelve a iniciar sesión.";
  if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/Email not confirmed/i.test(m)) return "Aún no confirmas tu correo. Revisa tu bandeja de entrada (y la carpeta de spam).";
  if (/already registered|already been registered|already exists/i.test(m)) return "Ya existe una cuenta con ese correo. Inicia sesión.";
  if (/Password should be at least|password.*characters/i.test(m)) return "La contraseña debe tener al menos 8 caracteres.";
  if (/rate limit|too many|security purposes/i.test(m)) return "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.";
  if (/valid email|invalid format|Unable to validate email/i.test(m)) return "El correo no es válido.";
  if (/same.*password|different from the old/i.test(m)) return "La nueva contraseña debe ser distinta a la anterior.";
  return "Ocurrió un error: " + m;
}

// ---------- Aviso flotante ----------
let toastTimer;
export function toast(text, kind = "ok") {
  let t = document.getElementById("toast");
  if (!t) {
    t = h("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.append(t);
  }
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

// ---------- Plan Estándar ----------
const NIVEL = { demo: 0, basico: 1, estandar: 2, profesional: 3, premium: 4 };
/** demo y básico = 0/1; Estándar o superior = 2+. Mismo criterio que public._plan_nivel() en la base. */
export const nivelPlan = (plan) => NIVEL[plan] ?? 0;
/** Demo vigente (plan demo y trial_ends_at en el futuro). */
export const demoVigente = (taller) =>
  taller?.plan === "demo" && !!taller.trial_ends_at && new Date(taller.trial_ends_at) > new Date();
/** Funciones del Plan Estándar: plan Estándar o superior, o demo vigente (mismo criterio que public._con_estandar()). */
export const tieneEstandar = (taller) => nivelPlan(taller?.plan) >= 2 || demoVigente(taller);

/** WhatsApp de Zynthea con el mensaje para mejorar el plan. */
export const mejorarPlanUrl = (taller, funcion) =>
  `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
    `Hola Karen, quiero mejorar al Plan Estándar del Sistema para Talleres${taller?.nombre ? ` para "${taller.nombre}"` : ""}` +
    (funcion ? ` (me interesa: ${funcion})` : "") + ".")}`;

// ---------- Dinero (USD, Ecuador) ----------
const fmtUSD = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" });
export const usd = (n) => fmtUSD.format(Number(n) || 0);
/** Número de un campo (acepta coma decimal); vacío → null. */
export function num(fd, name) {
  const v = val(fd, name);
  if (v == null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

// ---------- Enlaces de envío ----------
/** Teléfono de Ecuador a formato internacional para wa.me (0991234567 → 593991234567). */
export function telWa(tel) {
  let d = (tel || "").replace(/\D/g, "");          // quita espacios, guiones, paréntesis y el "+"
  if (d.startsWith("00")) d = d.slice(2);          // 00593… → 593…
  if (d.startsWith("0")) d = "593" + d.slice(1);   // 0980451896 → 593980451896
  else if (d.length === 9 && d.startsWith("9")) d = "593" + d;   // 980451896 → 593980451896
  return d.length >= 11 && d.length <= 15 ? d : "";
}
export const waUrl = (tel, texto) => `https://wa.me/${telWa(tel)}?text=${encodeURIComponent(texto)}`;
export const mailtoUrl = (correo, asunto, cuerpo) =>
  `mailto:${encodeURIComponent(correo || "")}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
/** URL absoluta de una página pública del sistema (orden.html, presupuesto.html, enlaces.html). */
export const urlPublica = (pagina, token) => new URL(`${pagina}?t=${encodeURIComponent(token)}`, location.href).href;

// ---------- Fechas: inicio y fin de un mes en Ecuador (UTC-5 fijo) ----------
export function rangoMes(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const desde = new Date(Date.UTC(y, m - 1, 1, 5));
  const hasta = new Date(Date.UTC(y, m, 1, 5));
  return [desde.toISOString(), hasta.toISOString()];
}
export const mesActual = () => toLocalInput().slice(0, 7);
export const hoyLocal = () => toLocalInput().slice(0, 10);
