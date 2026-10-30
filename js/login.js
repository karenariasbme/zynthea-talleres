import { sb } from "./sb.js";
import { errMsg } from "./util.js";

const $ = (id) => document.getElementById(id);
const forms = {
  login: $("form-login"),
  signup: $("form-signup"),
  reset: $("form-reset"),
  newpass: $("form-newpass"),
};
const msg = $("msg");
const appUrl = new URL("app.html", location.href).href;
const loginUrl = new URL("index.html", location.href).href;

function show(name) {
  for (const [k, f] of Object.entries(forms)) f.hidden = k !== name;
  $("tab-login").setAttribute("aria-selected", String(name === "login"));
  $("tab-signup").setAttribute("aria-selected", String(name === "signup"));
  $("tabs").hidden = name === "newpass";
  setMsg("");
}

function setMsg(text, kind = "error") {
  msg.textContent = text;
  msg.className = `msg ${kind}`;
  msg.hidden = !text;
}

/** Ejecuta la acción del formulario con el botón deshabilitado y muestra el error si falla. */
function onSubmit(form, fn) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Procesando…";
    setMsg("");
    try {
      await fn(new FormData(form));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

$("tab-login").addEventListener("click", () => show("login"));
$("tab-signup").addEventListener("click", () => show("signup"));
$("go-reset").addEventListener("click", () => show("reset"));
$("back-login").addEventListener("click", () => show("login"));
if (location.hash === "#registro") show("signup");

onSubmit(forms.login, async (fd) => {
  const { error } = await sb.auth.signInWithPassword({
    email: fd.get("email").trim(),
    password: fd.get("password"),
  });
  if (error) throw error;
  location.replace(appUrl);
});

onSubmit(forms.signup, async (fd) => {
  const taller = fd.get("taller").trim();
  const password = fd.get("password");
  if (!taller) return setMsg("Escribe el nombre de tu taller.");
  if (password.length < 8) return setMsg("La contraseña debe tener al menos 8 caracteres.");
  const { data, error } = await sb.auth.signUp({
    email: fd.get("email").trim(),
    password,
    options: { data: { taller_nombre: taller }, emailRedirectTo: appUrl },
  });
  if (error) throw error;
  // Con confirmación de correo activa, un correo ya registrado devuelve un usuario sin identidades
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return setMsg("Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.");
  }
  if (data.session) return location.replace(appUrl);
  forms.signup.reset();
  setMsg("Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego inicia sesión aquí.", "ok");
});

onSubmit(forms.reset, async (fd) => {
  const { error } = await sb.auth.resetPasswordForEmail(fd.get("email").trim(), { redirectTo: loginUrl });
  if (error) throw error;
  setMsg("Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva.", "ok");
});

onSubmit(forms.newpass, async (fd) => {
  const password = fd.get("password");
  if (password.length < 8) return setMsg("La contraseña debe tener al menos 8 caracteres.");
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
  location.replace(appUrl);
});

// Enlace de recuperación de contraseña: mostrar el formulario de contraseña nueva
const isRecovery = location.hash.includes("type=recovery");
sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") show("newpass");
});
if (isRecovery) {
  show("newpass");
} else {
  const { data } = await sb.auth.getSession();
  if (data.session) location.replace(appUrl);
}
