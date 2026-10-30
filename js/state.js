// Estado compartido de la app (se llena en app.js al iniciar)
export const state = {
  taller: null,           // { id, nombre, plan, trial_ends_at, ruc, direccion, telefono, correo, logo_path }
  refresh: () => {},      // vuelve a pintar la pantalla actual
  updateChrome: () => {}, // vuelve a pintar logo y nombre en la barra superior y el menú
};
