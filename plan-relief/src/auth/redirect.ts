import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

// Page de retour de la fenêtre de connexion Microsoft (MSAL 5) : elle transmet la réponse
// à la page principale, qui ferme la fenêtre. À déclarer dans Entra ID comme URI de
// redirection « Application monopage (SPA) » : https://<site>/auth-redirect.html
broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = 'La connexion Microsoft a échoué. Fermez cette fenêtre et réessayez.';
});
