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
