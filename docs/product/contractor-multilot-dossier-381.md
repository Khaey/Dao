# Dossier contractuel multi-lots par chantier et Artisan — #381

## Identités et invariants

- L'attribution reste **par lot** : `request_id`, `award_id`, `contractor_id`, somme précise en **millimes TND entiers**.
- Un même Artisan peut gagner plusieurs lots dans un chantier. Un lot ne peut avoir qu'un seul titulaire commercial actif à la fois.
- Le dossier de regroupement a pour identité logique `(project_id, contractor_id)`. Aucun regroupement entre chantiers ni entre Artisans.
- Le dossier ne remplace **pas** la fondation P2.2-A existante : **un contrat technique par award** (#125). Il agrège en lecture les attributions, sans déplacer leurs autorisations, versions ou archives.
- Un award n'autorise **pas** l'Artisan à devenir `project_member`. Toute API/UI doit contrôler les droits **par lot gagné**, jamais étendre la lecture au chantier entier.
- Un lot attribué n'accepte plus de nouvelle candidature ; les autres lots/sous-lots restent publiables suivant leurs propres règles et dépendances.

## Transitions attendues

| Événement | État visible | Si contrat activé | Si contrat désactivé |
| --- | --- | --- | --- |
| Lot A remporté par Artisan X | A attribué, fermé aux candidatures | dossier X préparatoire non signé, référence à A | A attribué, accès à A uniquement |
| Lot B remporté par X plus tard | A et B attribués | dossier X reflète A+B, **proposition de révision/avenant explicite** si un snapshot a été accepté | accès à A+B |
| Lot C remporté par Artisan Y | C attribué à Y | dossier Y distinct | accès uniquement à C pour Y |
| Lot D non attribué | D toujours ouvert | aucune inclusion prématurée | aucune inclusion |
| Annulation de B | B redevient éligible selon règles commerciales | historique conservé, recalcul dossier courant; contrat signé immuable, nécessité de document correctif explicite | historique/accès B mis à jour selon annulation |

## Compatibilité avec #125 et #345

- Les contrats P2.2-A contiennent déjà versions, hashes, archives, RLS et principe tripartite. **Ne jamais** fusionner silencieusement des archives ou modifier un contrat accepté/signé.
- Le précontrat A1/A2/A3 (#345) est informatif, distinct des signatures et paiements. Les futures échéances doivent être rattachées au document/version correspondant et ne constituent ni facture ni dette.
- Le regroupement initial livré en PR #382 est **une projection pure sans écriture**, non un engagement juridique ni une autorisation. Le champ `contractStatus: not_prepared` est délibéré.
- Choisir dans une prochaine tranche la source de vérité pour « contrat activé » et le workflow d'amendement **après audit des DTO / migrations existantes**. Toute migration partagée DEV impose GO OPS dédié ; pas d'opération PROD.

## Tests indispensables avant clôture

1. Deux lots pour X (éventuellement un seul award portant deux lot-items), un lot pour Y, un lot ouvert ; totaux précis.
2. Client autorisé voit les groupes du chantier ; X voit seulement ses lots et non ceux de Y ; non-participant non-titulaire reçoit refus.
3. Contrat désactivé : droits limités au lot, aucun faux brouillon obligatoire.
4. Contrat activé : création idempotente du dossier non signé ; ajout tardif préserve snapshot signé/accepté et propose une révision explicite.
5. Annulation partielle, dépendances inter-lots et historique des versions ; aucune double attribution active ni perte de données.
6. Tests API/JWT et RLS Supabase fraîche, E2E desktop/mobile, CI protégée sur HEAD, deploy-dev, recette Client et Artisan réels.

## Parcours simplifié — arbitrage UX PILOT 10

Les 6 jalons « Après publication » sont des **indicateurs**, pas 6 formulaires obligatoires. Pour le Client et l'Artisan, viser **zéro action supplémentaire** hors les consentements/signatures réellement requis.

| Situation | Écran de synthèse | Action principale |
| --- | --- | --- |
| Un lot attribué à X | X, un lot, montant, statut | Continuer les conditions du lot si nécessaires |
| Deux lots remportés par X | **Un groupe X**, deux lots, total, sans doubler les liens | Continuer le dossier X (si configuré et disponible) |
| Deux Artisans X et Y | Un groupe par titulaire, lots séparés | Action contextuelle du groupe concerné uniquement |
| Contrat désactivé | Pas de bloc contractualisation | Voir et suivre les lots auxquels l'utilisateur est autorisé |
| Lot ajouté après version préparée/acceptée | Ancien contrat figé ; nouvelle attribution visible séparément | Proposer explicitement la suite documentaire, jamais modifier un contrat signé |

Le panneau de regroupement n'affiche **aucun second bouton de signature**. Les liens « Définir les conditions avec l'Artisan » déjà existants restent la seule entrée précontractuelle tant que le dossier unifié n'a pas de véritable route et de droits prouvés. Les API par award et les versions immuables continuent à faire autorité.

### Limites de la tranche frontend #382

L'agrégation lit seulement les `award_items` actifs que le Client peut déjà consulter, puis exclut les awards annulés. Elle n'accorde aucune nouvelle permission et ne crée pas de contrat. **Le déclenchement automatique paramétrable est une autre tranche**, à concevoir après vérification d'un réglage existant, du service de confiance autorisé à préparer, de la compatibilité 1 contrat/award et des contraintes juridiques. Le SQL DEV partagé n'est pas modifié par cette PR.
