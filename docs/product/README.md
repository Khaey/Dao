# D.A.O. — Spécifications fonctionnelles

Index des spécifications **existantes**, rangées selon le parcours métier. Ce dossier ne duplique
pas les autres documents : il pointe vers eux là où ils se trouvent. Les décisions validées sont
résumées dans [../decisions.md](../decisions.md) ; une nouvelle spécification fonctionnelle se crée
ici (`docs/product/<domaine>.md`) et s'ajoute à cet index dans la même PR.

## Parcours

```text
Chantier → Lots (+ sous-lots officiels) → Revue D.A.O. → Publication → Offres (devis, sous-lots
proposés, RFI, négociation) → Attribution par lot → Conditions facultatives (accord, échéancier)
→ Contrat (si activé) → Suivi des travaux (Tableau/Gantt, carnet, métrés) → Réception technique
et réserves
```

## Index par domaine

| Domaine | Spécification | Issue de référence |
| --- | --- | --- |
| Règles métier socle (projet, lots, versions, revue, publication, budgets, rôles) | [ai-context/BUSINESS_RULES.md](../ai-context/BUSINESS_RULES.md) §1–§23 | #44, #83 |
| Profil professionnel / annuaire | [professional-profile.md](../professional-profile.md), [artisan-space-audit.md](../artisan-space-audit.md) | #83, #112 |
| Chantiers collaboratifs et invitations | [ai-context/COLLABORATION_DESIGN.md](../ai-context/COLLABORATION_DESIGN.md) | — |
| Devis PDF | [quote-pdf.md](quote-pdf.md) | #367 |
| Après attribution (état post-award) | [post-award-state.md](post-award-state.md) | #44 |
| Multi-lots par chantier et Artisan | [contractor-multilot-dossier-381.md](contractor-multilot-dossier-381.md) | #381 |
| Accord précontractuel | [precontract-agreement-v1.md](precontract-agreement-v1.md) | #345, #346 |
| Échéances informatives | [precontract-installment-tracking-v1.md](precontract-installment-tracking-v1.md) | #345, #397 |
| Contrat V1 | [contract-v1-design.md](contract-v1-design.md) | #61, #125, #390 |
| Signature électronique (préparation, hors GO) | [contract-electronic-signature-v1.md](contract-electronic-signature-v1.md) | #383 |
| Carnet d'exécution, métrés | [site-execution-design.md](../site-execution-design.md) | #289 |
| Suivi natif : Tableau, Gantt, options facultatives | [ux/410-tableau-natif.md](../ux/410-tableau-natif.md), spécification gelée [#408](https://github.com/Khaey/Dao/issues/408#issuecomment-6388003011) | #408, #409, #419 |
| Dossier documentaire V2 (plans versionnés, lots, revue technique) | [document-dossier-v2.md](document-dossier-v2.md) | #456 |
| Réception technique et réserves | Spécification dans [#425](https://github.com/Khaey/Dao/issues/425) ; résumé [decisions.md §9](../decisions.md#9-réception-technique-et-réserves-p11) | #425, #438 |
| Paramètres (moteur Settings) | [settings-engine.md](settings-engine.md), spécification S0 [#423](https://github.com/Khaey/Dao/issues/423#issuecomment-6392554996) | #423, #426, #126 |
| Messagerie et assistance | [messages-assistance.md](../messages-assistance.md) | #116, #271, #273 |
| Notifications | [notifications-s1.md](../notifications-s1.md), [notifications-s2.md](../notifications-s2.md) | #231 |
| Back-office Gestionnaire | [backoffice-v2.md](../backoffice-v2.md), [backoffice-v2-followup.md](../backoffice-v2-followup.md) | #64 |
| Planning global (OCE, historique) | [architecture/project-global-plan.md](../architecture/project-global-plan.md) | #325 |

Programme UX transversal : [#387](https://github.com/Khaey/Dao/issues/387) (la notion « Simple/Avancé »
y est **supersédée** par le parcours unique progressif, voir decisions.md §0). Idées non arbitrées :
[#299](https://github.com/Khaey/Dao/issues/299).
