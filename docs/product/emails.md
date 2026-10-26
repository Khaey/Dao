# E-mails D.A.O (#482)

Tous les e-mails envoyés par le dépôt utilisent **un seul gabarit** : `dao-backend/src/services/emailLayout.ts`.

## Gabarit
- **Structure** : tables et CSS en ligne, largeur max 600 px, cadre Outlook (`<!--[if mso]>`), media query pour mobile ≤ 520 px.
- **Identité** : logotype texte « D.A.O. », palette encre / sable / teal / argile, signature « Transparence · Précision · Confiance ».
- **Interdits** : aucune image, police web, ressource distante, script ou pixel de suivi.
- **Accessibilité** : pré-en-tête caché, un seul bouton d'action (CTA), version texte complète avec l'URL, `lang="fr"`.
- **Sécurité** : toutes les données passent par `escapeHtml`. Les objets ne contiennent jamais de donnée utilisateur ni de retour à la ligne.

## E-mails couverts
| Envoi | Fichier | Types |
|---|---|---|
| Invitation chantier (direct Resend) | `ResendEmailTransport.projectInvitationMessage` | invitation |
| Outbox `notification_outbox` | `ReviewNotificationWorker.reviewMessage` | `review_submitted`, `review_resubmitted`, `review_claimed`, `review_reassigned`, `staff_project_updated`, `review_approved`, `review_rejected`, `bid_submitted`, `bid_result` (`selected` / `not_selected` / `available`), `lot_withdrawn`, `lot_withdrawn_professional` |

Destinataires, URLs, idempotence Resend et outbox sont inchangés : seul le rendu passe par le gabarit.

## Règles de rédaction
- « Retenue » n'est jamais un contrat.
- Une approbation n'est pas une publication.
- Une offre reçue n'est pas un choix.
- Jamais de prix, d'identité de concurrent ni de coordonnées.

## Aperçus
```
cd dao-backend && npm run build && node dist/tests/email-catalog.js /tmp/dao-emails
```
Le script écrit un fichier HTML et un fichier texte par variante, plus un `index.html` (largeurs ordinateur et téléphone). Les données sont fictives. Les tests `tests/email-templates.test.ts` vérifient chaque variante.

## E-mails Supabase Auth (#482 D3)

Les modèles sont versionnés dans `dao-backend/supabase/templates/`. Ils sont générés depuis `dao-backend/tests/auth-email-templates.ts` avec le même gabarit, et un test vérifie qu'ils sont à jour.

| Modèle | Objet | Utilisé par l'app |
|---|---|---|
| `invite` | Invitation à rejoindre l’équipe D.A.O | Oui : invitation staff → `/auth/activate-staff` |
| `recovery` | Réinitialisation de votre mot de passe D.A.O | Oui : mot de passe oublié → `/auth/reset-password` |
| `confirmation` | Confirmez votre adresse e-mail D.A.O | Seulement si « Confirm email » est actif sur le projet |
| `email_change` | Confirmez votre nouvelle adresse e-mail D.A.O | Non (aucun écran) |
| `magic_link` | Votre lien de connexion D.A.O | Non (aucun écran) |

Variables officielles Supabase : `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`. Chaque modèle contient un seul lien, `{{ .ConfirmationURL }}`, qui conserve les redirections déjà configurées.

**Stack locale et CI** : les modèles sont branchés dans `config.toml` (`[auth.email.template.*]`). Les E2E réels lisent la boîte locale ; ils couvrent l'invitation staff et le mot de passe oublié.

**Projet hébergé (DEV, puis PROD)** : rien n'est appliqué automatiquement. Il faut le faire à la main, sur décision explicite.
1. Supabase → *Authentication* → *Emails* → *Templates*. Pour chaque modèle, copier l'objet ci-dessus et coller le contenu du fichier `.html`.
2. Vérifier que l'URL du site et les URL de redirection sont inchangées.
3. Tester avec une boîte autorisée : mot de passe oublié, puis invitation staff.

Alternative : `supabase config push` lié au projet. Elle pousse aussi le reste de `config.toml` : ne l'utiliser qu'après revue complète.
