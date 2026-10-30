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

// ---------- Placas ----------
export const normPlaca = (p) => (p || "").toUpperCase().replace(/[\s-]/g, "");

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
