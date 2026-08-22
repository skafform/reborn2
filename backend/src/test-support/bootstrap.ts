/**
 * Ce qu'un processus de test doit charger avant de toucher à l'autorisation.
 *
 * ⚠️ **Le registre de permissions ne contient que ce que les modules chargés y
 * ont versé** (ADR 0019). Le serveur s'en charge dans `app.ts` ; un test qui
 * appelle les services directement ne passe pas par là, et sèmerait des rôles
 * système amputés — un `guest` sans aucune permission résout un grant `null`,
 * et l'échec ne ressemble en rien à sa cause.
 *
 * Ce module est un **point de composition**, au même titre qu'`app.ts` : c'est
 * pour ça que la règle de lint l'exempte nommément. Un fichier de test, lui,
 * n'a toujours pas le droit d'importer `src/cms/` — il importe ceci.
 */
import "../cms/permissions.ts";
