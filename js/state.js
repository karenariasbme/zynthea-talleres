// Estado compartido de la app (se llena en app.js al iniciar)
export const state = {
  taller: null,      // { id, nombre, plan, trial_ends_at }
  refresh: () => {}, // vuelve a pintar la pantalla actual
};
