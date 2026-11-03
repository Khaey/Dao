# Assistant BTP — parcours et contrat du référentiel (v1)

Owner : **Coordinateur Mission 1** ([#543](https://github.com/Khaey/Dao/issues/543)). Référentiel : **DEV 5**
([#541](https://github.com/Khaey/Dao/issues/541)). Décisions : [decisions.md §12](../decisions.md#12-assistant-btp-création-de-chantier).

## Parcours Client

`/app/projects/new` → « Décrire mon projet à l'assistant » → `/app/projects/new/assistant`.

1. **Description libre** (type de projet facultatif, détecté sinon). Aucune question préalable.
2. **Proposition immédiate** : titre, résumé, « Ce que j'ai compris » (Connu / Proposé / À confirmer),
   lots → sous-lots → ouvrages cochés, autres possibilités repliées, limites affichées, provenance du
   référentiel et mode du moteur. Au plus **une** question, seulement si elle débloque la proposition
   (type inconnu, description sans aucun élément reconnu).
3. **Corrections** : cases à cocher, ou phrase libre (« ajoute une terrasse, retire le garage »,
   « c'est plutôt une rénovation », « à Sousse »). Les choix du client priment et sont conservés ;
   un texte non reconnu n'ajoute rien (« Rien n'a été inventé »).
4. **Créer mon chantier** (gouvernorat requis) : chantier **brouillon** classique (même suite que
   les autres parcours : dates, documents, revue D.A.O.), un lot par lot retenu, un sous-lot officiel
   par sous-lot retenu, ouvrages listés dans le périmètre, **aucun budget**.

Le brouillon est enregistré à chaque étape et repris au retour (« Reprendre » / « Recommencer »).

## Garanties

- Seuls des éléments du référentiel (ids canoniques) sont proposés ; les ids inconnus sont refusés
  par l'API et la création revérifie la sélection contre le référentiel courant.
- Jamais de prix, quantité, métré, durée, conformité réglementaire ou constructibilité ; les surfaces
  citées par le client sont reprises telles quelles, sans répartition par niveau.
- Moteur **par règles déterministes** (`engine.mode = "rules"`), affiché « sans IA générative ».
  Un LLM ne pourra être branché qu'après décision du propriétaire (fournisseur, coût, clés via #515),
  et ses sorties devront repasser par la même validation contre le référentiel.
- Brouillon visible du seul propriétaire (RLS), écrit uniquement par RPC (`save_…`, `abandon_…`,
  `create_project_from_assistant_draft_v1`) ; révisions **append-only** ; création atomique et
  idempotente (un brouillon donne au plus un chantier).

## API

`GET /api/projects/assistant` → `{ data: DraftView | null }` (dernier brouillon ouvert).
`POST /api/projects/assistant` avec une action :

| Action | Corps | Effet |
| --- | --- | --- |
| `analyze` | `description`, `projectType?`, `governorateId?` | Nouveau brouillon + proposition |
| `edit` | `draftId`, `expectedRevision`, et au moins un de `command`, `toggle {itemId, selected}`, `projectType`, `governorateId`, `answer` | Nouvelle révision (409 si révision obsolète) |
| `abandon` | `draftId` | Ferme le brouillon |
| `create` | `draftId`, `creationKey` | `{ projectId, created, lots }` ; rejouable sans doublon |

Erreurs : 400 (champ inattendu, id hors référentiel), 401, 403, 404, 409, 503 (référentiel
indisponible ou non conforme : **aucune proposition dégradée inventée**).

## Contrat du référentiel v1 (pour DEV 5)

Source : [`dao-backend/src/assistant/referential/contract.ts`](../../dao-backend/src/assistant/referential/contract.ts).
Port lu par l'assistant : `BtpReferentialPort.snapshot({ countryCode }) → ReferentialSnapshot`.

```ts
ReferentialSnapshot = { contractVersion: '1', provider, catalogVersion, countryCode,
  completeness: 'fixture' | 'partial' | 'complete', items: ReferentialItem[] }
ReferentialItem = { id, code, kind: 'lot' | 'sub_lot' | 'work', parentId, label, description?,
  tradeCode /* public.trades.code, requis pour un lot */, unit /* m, m2, m3, u, ens — sans quantité */,
  applicability: [{ projectKind: 'construction'|'renovation'|'extension'|'other',
                    relevance: 'usual'|'verify'|'conditional'|'optional' }],
  keywords /* FR, extensible arabe/tunisien */, relatedIds?, status: 'published'|'deprecated',
  provenance: { source, version, verifiedOn } }
```

Règles : hiérarchie stricte lot → sous-lot → ouvrage ; ids stables (un élément retiré passe
`deprecated`, son id n'est pas réutilisé) ; provenance obligatoire ; **aucun champ prix, quantité ou
durée**. `validateReferentialSnapshot()` est le test de conformité : l'assistant refuse (503) un
instantané non conforme. Pertinence : `usual` et `verify` sont proposés d'office (`verify` signalé
« À vérifier »), `conditional` et `optional` sont suggérés seulement.

**Aujourd'hui** : `FixtureReferentialProvider` (données fictives conformes, `completeness: 'fixture'`).
**À la livraison #541** : un adaptateur lisant l'API publiée par DEV 5 remplace la fixture dans
`createProjectAssistantApi` (`dao-backend/src/server/runtime.ts`), sans autre changement.

## Données conservées (préparation métrés / estimation)

`project_assistant_scope_links` relie chaque lot / sous-lot officiel créé aux éléments du référentiel
(provider, version, id, code, unité, pertinence). Les phases « métrés vérifiables » et « estimation »
s'appuieront sur ces liens ; aucune valeur chiffrée n'y est stockée.
