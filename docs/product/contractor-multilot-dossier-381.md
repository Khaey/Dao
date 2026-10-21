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
